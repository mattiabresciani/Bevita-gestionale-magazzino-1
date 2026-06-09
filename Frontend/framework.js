// Base API: stesso host della pagina (localhost o 127.0.0.1) per evitare mismatch di origine
const API_BASE = window.BACKEND_URL;

// ── Autenticazione / redirect (UNICO punto, condiviso da tutte le pagine) ──────
// Comportamento coerente ovunque:
//   • manca il token            → login.html
//   • risposta 401 (scaduto)    → rimuovi il token e vai a login.html
//   • pagina solo-admin + ruolo non admin → index.html
// (prima ogni pagina lo gestiva a modo suo: alcune non lo gestivano affatto.)
function authToken() { return localStorage.getItem('token'); }

function logoutUtente() {
    localStorage.removeItem('token');   // solo il token: lo scaffale vive sul DB
    window.location.href = 'login.html';
}

// Guard base: chiama in cima a ogni pagina protetta. Ritorna false se ha già reindirizzato.
function richiediAutenticazione() {
    if (!authToken()) { window.location.href = 'login.html'; return false; }
    return true;
}

// Recupera le info utente con gestione coerente degli errori. Ritorna i dati o null.
async function infoUtente() {
    if (!authToken()) { window.location.href = 'login.html'; return null; }
    try {
        const r = await fetch(API_BASE + '/logininfo', { headers: { 'Authorization': 'Bearer ' + authToken() } });
        if (r.status === 401) { logoutUtente(); return null; }
        if (!r.ok) return null;
        return await r.json();
    } catch { return null; }   // server irraggiungibile: non buttare fuori l'utente
}

// Guard pagine SOLO-ADMIN: login se non autenticato/scaduto, index se non admin.
async function richiediAdmin() {
    const d = await infoUtente();
    if (!d) return null;                  // infoUtente ha già gestito login/401
    if (d.ruolo !== 'admin') { window.location.href = 'index.html'; return null; }
    return d;
}

// ── Combobox con ricerca (stile scaffalatura) ──────────────────────────────────
// Sostituisce i <select> pieni di voci: barra in cui digitare + elenco bianco
// filtrato sotto. La ricerca filtra per CODICE o DESCRIZIONE.
//   opzioni = [{ value, label, codice?, desc?, tag? }]
//     - label   = testo mostrato nella barra quando l'opzione è scelta
//     - codice  = codice articolo (se presente: mostrato in rosa nell'elenco e cercabile)
//     - desc    = descrizione (mostrata sotto il codice nell'elenco)
//   extra (opzionale) = { id, value, onChange, wide, placeholder }
//     - id      = se presente crea un <input type="hidden" id=ID> col valore scelto,
//                 così il codice esistente può leggere getElementById(ID).value e
//                 ricevere l'evento 'change' alla selezione.
//     - value   = valore iniziale già selezionato.
// Metodi sull'elemento ritornato: .getValore() (opzione o null), .setValore(v), .reset().
function creaAutocomplete(opzioni, placeholder, extra = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'ac-wrap' + (extra.wide ? ' ac-wide' : '');

    let hidden = null;
    if (extra.id) {
        hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.id = extra.id;
        wrap.appendChild(hidden);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tree-input ac-input';
    input.placeholder = placeholder || 'Cerca per codice o descrizione...';
    input.autocomplete = 'off';
    wrap.appendChild(input);

    const list = document.createElement('div');
    list.className = 'ac-list';
    list.style.display = 'none';
    document.body.appendChild(list);

    // rimuove la lista (appesa al body) quando l'input viene tolto dal DOM
    const obs = new MutationObserver(() => {
        if (!document.body.contains(input)) { list.remove(); obs.disconnect(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    let selezionato = null;
    let aperto = false;

    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    const testoRicerca = o => ((o.codice ? o.codice + ' ' : '') + (o.label || '') + ' ' + (o.desc || '')).toLowerCase();

    function applica(o) {
        selezionato = o || null;
        input.value = o ? o.label : '';
        input.classList.toggle('ac-scelto', !!o);
        if (hidden) hidden.value = o ? o.value : '';
    }

    function posiziona() {
        const r = input.getBoundingClientRect();
        list.style.left  = r.left + 'px';
        list.style.top   = (r.bottom + 4) + 'px';
        list.style.width = r.width + 'px';
    }

    function render() {
        // se l'utente non ha ancora digitato (input = opzione scelta) mostra tutto
        const q = (selezionato && input.value === selezionato.label) ? '' : input.value.toLowerCase().trim();
        const filt = (q ? opzioni.filter(o => testoRicerca(o).includes(q)) : opzioni).slice(0, 80);
        list.innerHTML = filt.length
            ? filt.map((o, i) =>
                '<div class="ac-item" data-i="' + i + '">' +
                    (o.codice
                        ? '<span class="ac-cod">' + esc(o.codice) + '</span><span class="ac-desc">' + esc(o.desc || o.label) + '</span>'
                        : '<span class="ac-lab">' + esc(o.label) + '</span>') +
                    (o.tag ? '<span class="ac-tag ac-tag-' + esc(o.tag).replace(/\s+/g, '-') + '">' + esc(o.tag) + '</span>' : '') +
                '</div>').join('')
            : '<div class="ac-empty">Nessun risultato</div>';
        list.querySelectorAll('.ac-item').forEach(el => {
            el.addEventListener('mousedown', e => {   // mousedown: scatta prima del blur
                e.preventDefault();
                const o = filt[Number(el.dataset.i)];
                applica(o);
                chiudi();
                if (hidden) hidden.dispatchEvent(new Event('change', { bubbles: true }));
                if (extra.onChange) extra.onChange(o);
            });
        });
        posiziona();
        list.style.display = '';
        aperto = true;
    }

    function chiudi() { list.style.display = 'none'; aperto = false; }

    input.addEventListener('focus', () => { input.select(); render(); });
    input.addEventListener('input', render);
    input.addEventListener('blur', () => setTimeout(() => {
        chiudi();
        // ripristina il testo all'opzione effettivamente scelta (niente testo "sospeso")
        input.value = selezionato ? selezionato.label : '';
        input.classList.toggle('ac-scelto', !!selezionato);
    }, 150));
    input.addEventListener('keydown', e => {
        if (e.key === 'Escape') { chiudi(); input.blur(); }
        else if (e.key === 'Enter') {
            e.preventDefault();
            const primo = list.querySelector('.ac-item');
            if (aperto && primo) primo.dispatchEvent(new MouseEvent('mousedown'));
        }
    });
    window.addEventListener('scroll', () => { if (aperto) posiziona(); }, true);

    if (extra.value !== undefined && extra.value !== null && extra.value !== '') {
        const o = opzioni.find(x => String(x.value) === String(extra.value));
        if (o) applica(o);
    }

    wrap.getValore = () => selezionato;
    wrap.setValore = v => { const o = opzioni.find(x => String(x.value) === String(v)); applica(o || null); };
    wrap.reset = () => { applica(null); chiudi(); };
    return wrap;
}

// Costruisce l'header della pagina: inserisce il burger menu, il logo, la sidebar
// e i pill buttons. Gestisce apertura/chiusura sidebar e logout.
function initHeaderComponent() {
    const headerElement = document.getElementById('main-header');
    if (!headerElement) return;

    headerElement.innerHTML = `
        <div class="header-left">
            <button class="menu-btn" id="burger-menu-trigger" aria-label="Apri menu">
                <i class="fa-solid fa-bars"></i>
            </button>
            <h1 class="header-title">Gestionale</h1>
        </div>
        <div class="header-right">
            <a href="index.html">
                <img src="img/logoBevita.png" alt="Logo Bevita" class="logo-img">
            </a>
        </div>

        <div class="sidebar-menu" id="sidebar-menu">
            <div class="sidebar-header">
                <h3>Menu</h3>
                <button class="close-btn" id="sidebar-close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <nav class="sidebar-links">
                <a href="index.html" id="sidebar-home"><i class="fa-solid fa-house"></i> Homepage</a>
                <a href="magazzino.html" id="sidebar-magazzino"><i class="fa-solid fa-warehouse"></i> Inventario e Gestionale</a>
                <a href="scaffalatura.html" id="sidebar-magazzino"><i class="fa-solid fa-dolly"></i> Scaffalatura</a>
                <a href="user.html" id="sidebar-utenti"><i class="fa-solid fa-users-gear"></i> Gestione Utenti</a>
                <a href="documentazione.html" id="sidebar-utenti"><i class="fa-solid fa-book-bible"></i> Documentazione</a>
                <a href="#" id="sidebar-logout"><i class="fa-solid fa-right-from-bracket"></i> Disconnetti</a>
            </nav>
        </div>
        <div class="sidebar-overlay" id="sidebar-overlay"></div>
    `;

    // Nasconde la voce "Gestione Utenti" ai non-admin leggendo il ruolo dal JWT
    try {
        const token = localStorage.getItem('token');
        if (token) {
            const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (payload.ruolo !== 'admin') {
                const el = document.getElementById('sidebar-utenti');
                if (el) el.style.display = 'none';
            }
        }
    } catch(e) { /* token malformato — il link resta nascosto di default via CSS se vuoi */ }

    // Regola il comportamento del burger menu
    const burgerBtn = document.getElementById('burger-menu-trigger');
    const closeBtn = document.getElementById('sidebar-close');
    const sidebar = document.getElementById('sidebar-menu');
    const overlay = document.getElementById('sidebar-overlay');

    function toggleMenu() {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('open');
    }

    if (burgerBtn && closeBtn && sidebar && overlay) {
        burgerBtn.addEventListener('click', toggleMenu);
        closeBtn.addEventListener('click', toggleMenu);
        overlay.addEventListener('click', toggleMenu);
    }

    // Logout: usa l'helper condiviso (rimuove solo il token e va al login).
    const logoutBtn = document.getElementById('sidebar-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function (e) {
            e.preventDefault();
            logoutUtente();
        });
    }

    // Regola il comportamento dei pill buttons
    const pillButtons = document.querySelectorAll('.pill-btn');
    const pageTitle = document.querySelector('.page-title');

    pillButtons.forEach(button => {
        button.addEventListener('click', () => {
            pillButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            if (pageTitle) {
                pageTitle.textContent = button.textContent;
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', initHeaderComponent);

// Apre/chiude il contenuto di una card commessa con animazione a fisarmonica.
// Va chiamata dall'HTML con onclick="toggleAccordion(this)" sull'elemento header della card.
function toggleAccordion(headerElement) {
    const card = headerElement.parentElement;
    const panel = card.querySelector('.accordion-panel');

    card.classList.toggle('active');

    if (panel.style.maxHeight) {
        panel.style.maxHeight = null;
    } else {
        panel.style.maxHeight = panel.scrollHeight + "px";
    }
}

// Ricalcola l'altezza di un pannello accordion già aperto dopo che il suo
// contenuto interno è cambiato (es. aggiunta di un elemento).
function aggiornaAltezzaPanel(treeEl) {
    const panel = treeEl.closest('.accordion-panel');
    if (panel && panel.style.maxHeight) {
        panel.style.maxHeight = panel.scrollHeight + 'px';
    }
}

// ---------------------------------------------------------------
// FILTRI
// ---------------------------------------------------------------

// Configurazione filtri per sezione, basata sullo schema del DB
const filtriConfig = {
    'commesse': [
        {
            key: 'stato',
            label: 'Stato',
            type: 'select',
            options: [
                { value: '', label: 'Tutti' },
                { value: 'APERTA', label: 'Aperta' },
                { value: 'CHIUSA', label: 'Chiusa' }
            ]
        },
        {
            key: 'anno',
            label: 'Anno',
            type: 'number',
            placeholder: 'Es. 2024'
        },
        {
            key: 'descrizione',
            label: 'Descrizione',
            type: 'text',
            placeholder: 'Cerca descrizione...'
        }
    ],
    'macchine': [
        {
            key: 'descrizione',
            label: 'Descrizione',
            type: 'text',
            placeholder: 'Cerca descrizione...'
        },
        {
            key: 'quantita_min',
            label: 'Quantità minima',
            type: 'number',
            placeholder: 'Es. 1'
        },
        {
            key: 'quantita_max',
            label: 'Quantità massima',
            type: 'number',
            placeholder: 'Es. 100'
        }
    ],
    'materie-prime': [
        {
            key: 'descrizione',
            label: 'Descrizione',
            type: 'text',
            placeholder: 'Cerca descrizione...'
        },
        {
            key: 'quantita_min',
            label: 'Quantità minima',
            type: 'number',
            placeholder: 'Es. 1'
        },
        {
            key: 'quantita_max',
            label: 'Quantità massima',
            type: 'number',
            placeholder: 'Es. 100'
        }
    ]
};

// Stato attivo dei filtri per sezione
const filtriAttivi = {
    'commesse': {},
    'macchine': {},
    'materie-prime': {}
};

// Crea il pannello filtri e lo inserisce nel DOM (Document Object Model).
// Collega i bottoni "Azzera" e "Applica" alle relative azioni.
function initFiltriPanel() {
    if (document.getElementById('filter-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'filter-panel';
    panel.className = 'filter-panel';
    panel.innerHTML = `
        <div class="filter-panel-header">
            <span class="filter-panel-title"><i class="fa-solid fa-sliders"></i> Filtri</span>
            <button class="filter-panel-close" id="filter-panel-close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="filter-panel-body" id="filter-panel-body"></div>
        <div class="filter-panel-footer">
            <button class="filter-reset-btn" id="filter-reset-btn">Azzera</button>
            <button class="filter-apply-btn" id="filter-apply-btn">Applica</button>
        </div>
    `;
    document.body.appendChild(panel);

    const overlay = document.createElement('div');
    overlay.id = 'filter-panel-overlay';
    overlay.className = 'filter-panel-overlay';
    document.body.appendChild(overlay);

    document.getElementById('filter-panel-close').addEventListener('click', closeFiltriPanel);
    overlay.addEventListener('click', closeFiltriPanel);

    document.getElementById('filter-reset-btn').addEventListener('click', () => {
        const sezione = window._sezioneCorrenteFilters || 'commesse';
        filtriAttivi[sezione] = {};
        renderFiltriFields(sezione);
        applicaFiltri(sezione);
        aggiornaFilterBtnBadge(sezione);
    });

    document.getElementById('filter-apply-btn').addEventListener('click', () => {
        const sezione = window._sezioneCorrenteFilters || 'commesse';
        leggiCampiFiltroDalDOM(sezione);
        applicaFiltri(sezione);
        aggiornaFilterBtnBadge(sezione);
        closeFiltriPanel();
    });
}

// Apre il pannello filtri per la sezione indicata e riempie i campi.
function openFiltriPanel(sezione) {
    initFiltriPanel();
    window._sezioneCorrenteFilters = sezione;
    renderFiltriFields(sezione);
    document.getElementById('filter-panel').classList.add('open');
    document.getElementById('filter-panel-overlay').classList.add('open');
}

// Chiude il pannello filtri rimuovendo la classe "open".
function closeFiltriPanel() {
    const panel = document.getElementById('filter-panel');
    const overlay = document.getElementById('filter-panel-overlay');
    if (panel) panel.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
}

// Genera i campi input/select nel pannello in base alla sezione corrente,
// pre-compilando i valori già attivi.
function renderFiltriFields(sezione) {
    const body = document.getElementById('filter-panel-body');
    if (!body) return;
    const config = filtriConfig[sezione] || [];
    const attivi = filtriAttivi[sezione] || {};

    body.innerHTML = config.map(campo => {
        const val = attivi[campo.key] !== undefined ? attivi[campo.key] : '';
        if (campo.type === 'select') {
            const opts = campo.options.map(o =>
                `<option value="${o.value}"${val === o.value ? ' selected' : ''}>${o.label}</option>`
            ).join('');
            return `
                <div class="filter-field">
                    <label>${campo.label}</label>
                    <select id="flt_${campo.key}">${opts}</select>
                </div>`;
        }
        return `
            <div class="filter-field">
                <label>${campo.label}</label>
                <input type="${campo.type}" id="flt_${campo.key}" value="${val}" placeholder="${campo.placeholder || ''}">
            </div>`;
    }).join('');
}

// Legge i valori dai campi del pannello e li salva in filtriAttivi per la sezione indicata.
function leggiCampiFiltroDalDOM(sezione) {
    const config = filtriConfig[sezione] || [];
    const attivi = {};
    config.forEach(campo => {
        const el = document.getElementById('flt_' + campo.key);
        if (!el) return;
        const v = el.value.trim();
        if (v !== '') attivi[campo.key] = v;
    });
    filtriAttivi[sezione] = attivi;
}

// Mostra o nasconde le card della sezione in base ai filtri attivi in filtriAttivi.
function applicaFiltri(sezione) {
    const attivi = filtriAttivi[sezione] || {};
    const cards = document.querySelectorAll('[data-sezione="' + sezione + '"]');

    cards.forEach(card => {
        let record;
        try { record = JSON.parse(card.dataset.record); } catch { return; }

        let visibile = true;

        if (sezione === 'commesse') {
            if (attivi.stato && record.stato !== attivi.stato) visibile = false;
            if (attivi.anno && String(record.anno) !== String(attivi.anno)) visibile = false;
            if (attivi.descrizione && !(record.descrizione || '').toLowerCase().includes(attivi.descrizione.toLowerCase())) visibile = false;
        }

        if (sezione === 'macchine' || sezione === 'materie-prime') {
            if (attivi.descrizione && !(record.descrizione || '').toLowerCase().includes(attivi.descrizione.toLowerCase())) visibile = false;
            if (attivi.quantita_min && Number(record.quantita) < Number(attivi.quantita_min)) visibile = false;
            if (attivi.quantita_max && Number(record.quantita) > Number(attivi.quantita_max)) visibile = false;
        }

        card.style.display = visibile ? '' : 'none';
    });
}

// Aggiunge o rimuove il badge numerico sul pulsante filtri in base al numero di filtri attivi.
function aggiornaFilterBtnBadge(sezione) {
    const btn = document.querySelector('.filter-btn');
    if (!btn) return;
    const count = Object.keys(filtriAttivi[sezione] || {}).length;
    let badge = btn.querySelector('.filter-badge');
    if (count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'filter-badge';
            btn.appendChild(badge);
        }
        badge.textContent = count;
    } else {
        if (badge) badge.remove();
    }
}

// Collega il pulsante filtri (rosa) all'apertura del pannello per la sezione
// corrispondente al pill-btn attualmente attivo.
function initFilterBtn() {
    const btn = document.querySelector('.filter-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const activeBtn = document.querySelector('.pill-btn.active');
        const sezione = activeBtn ? activeBtn.dataset.target : 'commesse';
        openFiltriPanel(sezione);
    });
}

// Aggiorna il badge del pulsante filtri quando si cambia sezione tramite pill.
function initPillResetFiltri() {
    document.querySelectorAll('.pill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setTimeout(() => aggiornaFilterBtnBadge(btn.dataset.target), 0);
        });
    });
}

// Applica gli stili CSS del pannello filtri direttamente nel <head> via JS
// senza modificare file .css esterni. Si esegue una sola volta al caricamento.
(function injectFilterStyles() {
    if (document.getElementById('filter-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'filter-panel-styles';
    style.textContent = `
        .filter-panel {
            position: fixed;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%) scale(0.92);
            width: min(420px, 92vw);
            max-height: 85vh;
            background: #fff;
            box-shadow: 0 8px 40px rgba(0,0,0,0.18);
            z-index: 1100;
            display: flex; flex-direction: column;
            border-radius: 18px;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.22s ease, transform 0.22s ease;
        }
        .filter-panel.open {
            opacity: 1;
            pointer-events: all;
            transform: translate(-50%, -50%) scale(1);
        }

        .filter-panel-overlay {
            display: none;
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.35);
            z-index: 1099;
            backdrop-filter: blur(2px);
        }
        .filter-panel-overlay.open { display: block; }

        .filter-panel-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 18px 20px 14px;
            border-bottom: 1px solid #f0f0f0;
        }
        .filter-panel-title {
            font-weight: 600; font-size: 1rem; color: #222;
            display: flex; align-items: center; gap: 8px;
        }
        .filter-panel-close {
            background: none; border: none; cursor: pointer;
            font-size: 1.1rem; color: #888; padding: 4px;
        }
        .filter-panel-close:hover { color: #333; }

        .filter-panel-body {
            flex: 1; overflow-y: auto;
            padding: 16px 20px;
            display: flex; flex-direction: column; gap: 16px;
        }
        .filter-field { display: flex; flex-direction: column; gap: 6px; }
        .filter-field label {
            font-size: 0.8rem; font-weight: 600;
            color: #555; text-transform: uppercase; letter-spacing: 0.04em;
        }
        .filter-field input,
        .filter-field select {
            border: 1.5px solid #e0e0e0;
            border-radius: 10px;
            padding: 9px 12px;
            font-size: 0.9rem;
            color: #222;
            outline: none;
            transition: border-color 0.2s;
            background: #fafafa;
        }
        .filter-field input:focus,
        .filter-field select:focus { border-color: #e85d9b; background: #fff; }

        .filter-panel-footer {
            padding: 14px 20px;
            border-top: 1px solid #f0f0f0;
            display: flex; gap: 10px;
        }
        .filter-reset-btn {
            flex: 1; padding: 10px;
            border: 1.5px solid #e0e0e0; border-radius: 10px;
            background: #fff; color: #666;
            font-weight: 600; font-size: 0.9rem; cursor: pointer;
            transition: background 0.2s;
        }
        .filter-reset-btn:hover { background: #f5f5f5; }
        .filter-apply-btn {
            flex: 2; padding: 10px;
            border: none; border-radius: 10px;
            background: #e85d9b; color: #fff;
            font-weight: 600; font-size: 0.9rem; cursor: pointer;
            transition: background 0.2s;
        }
        .filter-apply-btn:hover { background: #d44e8a; }

        /* Badge contatore filtri attivi */
        .filter-btn { position: relative; }
        .filter-badge {
            position: absolute;
            top: -6px; right: -6px;
            background: #e85d9b; color: #fff;
            font-size: 0.65rem; font-weight: 700;
            width: 18px; height: 18px;
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
})();

document.addEventListener('DOMContentLoaded', () => {
    initFilterBtn();
    initPillResetFiltri();
});

// Da chiamare dopo ogni render di una sezione (es. dopo loadCommesse()) per
// riapplicare i filtri già attivi e aggiornare il badge del pulsante.
function applicaFiltriDopoRender(sezione) {
    const attivi = filtriAttivi[sezione] || {};
    if (Object.keys(attivi).length > 0) applicaFiltri(sezione);
    aggiornaFilterBtnBadge(sezione);
}

// ---------------------------------------------------------------
// SCAFFALATURA — posizionamento celle sulla foto
// ---------------------------------------------------------------

// Posizioni righe (% altezza foto)
const SCAFFALE_ROW_POS = {
    D: { top: 7,  h: 23 },
    C: { top: 34, h: 22 },
    B: { top: 60, h: 22 },
    A: { top: 85, h: 13 }
};

// Posizioni colonne (% larghezza foto)
const SCAFFALE_COL_POS = {
    1: { l: 5.5,  w: 10.8 },
    2: { l: 16.8, w: 10.8 },
    3: { l: 28.1, w: 10.8 },
    4: { l: 39.4, w: 10.8 },
    5: { l: 51.8, w: 10.8 },
    6: { l: 63.1, w: 10.8 },
    7: { l: 74.4, w: 10.8 },
    8: { l: 85.7, w: 11.8 }
};

const SCAFFALE_ROWS = ['D', 'C', 'B', 'A'];
const SCAFFALE_COLS = [1, 2, 3, 4, 5, 6, 7, 8];

let scaffaleCommesse     = [];
let scaffaleMateriali    = [];
let scaffaleActiveCellId = null;
let scaffaleFactoryComm  = null; // commessa attualmente aperta nel pannello fabbrica
let scaffaleFactoryCell  = null; // cella da cui è stata aperta

// ── Mappa cella → commessa (persistita sul DB) ─────────────────────
// La sorgente di verità è la tabella `scaffale_celle` sul server, così lo
// scaffale è identico da qualsiasi browser/PC. In pagina teniamo una cache
// in memoria (scaffaleCelleCache) caricata all'avvio e aggiornata ad ogni modifica.

let scaffaleCelleCache = {};

// Carica dal DB l'intera mappa cella → commessa nella cache.
async function scaffaleFetchCelle() {
    try { scaffaleCelleCache = await scaffaleGet('/scaffale/celle') || {}; }
    catch { scaffaleCelleCache = {}; }
    return scaffaleCelleCache;
}

// Lettura sincrona dalla cache (forma: { "A1": { commessa: {...} } }).
function scaffaleLoadCelle() {
    return scaffaleCelleCache;
}

// Assegna una commessa a una cella sul DB e aggiorna la cache.
async function scaffaleSetCella(cella, idCommessa) {
    const r = await fetch(API_BASE + '/scaffale/celle/' + cella, {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_commessa: idCommessa })
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.errore || r.status); }
    scaffaleCelleCache[cella] = await r.json();
}

// Svuota una cella sul DB e aggiorna la cache.
async function scaffaleClearCella(cella) {
    const r = await fetch(API_BASE + '/scaffale/celle/' + cella, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    if (!r.ok) throw new Error(r.status);
    delete scaffaleCelleCache[cella];
}

async function scaffaleGet(path) {
    const r = await fetch(API_BASE + path, {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    if (!r.ok) throw new Error(r.status);
    return r.json();
}

// ── Overlay celle sulla foto ───────────────────────────────────────

function scaffaleCommessaCella(id) {
    const c = scaffaleLoadCelle()[id];
    return c && c.commessa ? c.commessa : null;
}

// Colore distinto e stabile per ogni commessa (tonalità derivata dall'id con l'angolo aureo).
// La tinta della cella è semi-trasparente, così si vede la foto del pallet sotto.
function scaffaleColoreCommessa(id) {
    const hue = Math.round((Number(id) * 137.508) % 360);
    return {
        border: `hsl(${hue}, 72%, 46%)`,
        band:   `hsla(${hue}, 68%, 30%, 0.58)`
    };
}

function scaffaleBuildOverlay() {
    const overlay = document.getElementById('shelfOverlay');
    if (!overlay) return;
    overlay.innerHTML = '';
    const celle = scaffaleLoadCelle();

    SCAFFALE_ROWS.forEach(row => {
        SCAFFALE_COLS.forEach(col => {
            const id    = row + col;
            const rPos  = SCAFFALE_ROW_POS[row];
            const cPos  = SCAFFALE_COL_POS[col];
            const comm  = celle[id] && celle[id].commessa ? celle[id].commessa : null;

            const cell = document.createElement('div');
            cell.className = 'shelf-cell' + (comm ? ' occupied' : '');
            cell.dataset.id = id;
            cell.style.top    = rPos.top + '%';
            cell.style.left   = cPos.l   + '%';
            cell.style.width  = cPos.w   + '%';
            cell.style.height = rPos.h   + '%';

            // Badge coordinata visibile solo su hover
            const coord = document.createElement('div');
            coord.className = 'shelf-cell-coord';
            coord.textContent = id;
            cell.appendChild(coord);

            // Etichetta in basso: commessa assegnata alla cella, con colore distinto per commessa
            if (comm) {
                const col = scaffaleColoreCommessa(comm.id);
                cell.style.outline       = '2px solid ' + col.border;
                cell.style.outlineOffset = '-2px';
                const lbl = document.createElement('div');
                lbl.className = 'shelf-cell-label';
                lbl.style.background = col.band;   // tinta semi-trasparente: la foto resta visibile
                const commLine = document.createElement('span');
                commLine.className = 'scl-comm';
                commLine.textContent = comm.codice || ('N°' + comm.id);
                lbl.appendChild(commLine);
                cell.appendChild(lbl);
            }

            // Click: apre SEMPRE il pannello della cella. Se la cella è vuota, il pannello
            // mostra come primo passo l'assegnazione della commessa; poi la preparazione.
            cell.addEventListener('click', () => {
                scaffaleOpenFactory(scaffaleCommessaCella(id) || null, id);
            });
            overlay.appendChild(cell);
        });
    });

    // Etichette righe (D, C, B, A)
    SCAFFALE_ROWS.forEach(row => {
        const rPos = SCAFFALE_ROW_POS[row];
        const lbl = document.createElement('div');
        lbl.className = 'shelf-row-label';
        lbl.textContent = row;
        lbl.style.top = (rPos.top + rPos.h / 2) + '%';
        overlay.appendChild(lbl);
    });

    // Etichette colonne (1-8)
    SCAFFALE_COLS.forEach(col => {
        const cPos = SCAFFALE_COL_POS[col];
        const lbl = document.createElement('div');
        lbl.className = 'shelf-col-label';
        lbl.textContent = col;
        lbl.style.left = (cPos.l + cPos.w / 2) + '%';
        overlay.appendChild(lbl);
    });
}

// ── Step di assegnazione commessa (dentro il pannello della cella) ──
// Mostra nel pannello unico la scelta della commessa; alla conferma passa alla preparazione.
// `comm` valorizzato = si sta CAMBIANDO la commessa di una cella già assegnata.
function scaffaleRenderAssegna(cellId, comm) {
    scaffaleActiveCellId = cellId;
    const codiceEl = document.getElementById('spCodice');
    codiceEl.textContent = 'Cella ' + cellId;
    codiceEl.style.color = '#333';
    document.querySelector('#scaffalePopupOverlay .sp-header').style.boxShadow = 'none';
    document.getElementById('spDesc').textContent = comm ? 'Cambia la commessa di questa cella' : 'Cella vuota — assegna una commessa';

    const body = document.getElementById('spBody');
    body.innerHTML = `
        <div class="fb-assign">
            <p class="fb-assign-label"><i class="fa-solid fa-clipboard-list"></i> Quale commessa vuoi preparare in questa cella?</p>
            <div class="fb-assign-mount"></div>
            <div class="fb-assign-actions">
                ${comm ? '<button class="fb-assign-cancel" id="fbAssignCancel">Annulla</button>' : ''}
                <button class="fb-assign-save" id="fbAssignSave"><i class="fa-solid fa-check"></i> Assegna e prepara</button>
            </div>
            <p class="fb-assign-hint"><i class="fa-solid fa-circle-info"></i> Alla conferma si apre subito la preparazione dei materiali.</p>
        </div>`;

    const opzioni = scaffaleCommesse.map(c => ({
        value: String(c.id), codice: c.codice,
        desc: c.descrizione || '', label: c.codice + (c.descrizione ? ' — ' + c.descrizione : '')
    }));
    const combo = creaAutocomplete(opzioni, 'Cerca commessa per codice o descrizione...',
        { id: 'caSelect', value: comm ? comm.id : '', wide: true });
    body.querySelector('.fb-assign-mount').appendChild(combo);

    document.getElementById('fbAssignSave').addEventListener('click', async () => {
        const sel = document.getElementById('caSelect');
        const idc = sel && sel.value;
        if (!idc) { combo.querySelector('.ac-input').focus(); return; }
        const scelta = scaffaleCommesse.find(c => String(c.id) === String(idc));
        try { await scaffaleSetCella(cellId, scelta.id); }
        catch { alert('Impossibile salvare la cella (errore di rete).'); return; }
        scaffaleBuildOverlay();
        scaffaleOpenFactory(scelta, cellId);   // passa subito alla preparazione
    });
    const cancel = document.getElementById('fbAssignCancel');
    if (cancel) cancel.addEventListener('click', () => { if (comm) scaffaleOpenFactory(comm, cellId); });
}

// ── Pannello "fabbrica": preparazione materiali di una commessa ────

// Somma le rich_mat di una macchina per materiale (processi ricorsivi + materiali diretti)
function scaffaleAggregaMateriali(macchina) {
    const acc = {};
    const add = rm => {
        const k = rm.id_materiale;
        if (!acc[k]) acc[k] = { id_materiale: k, codice: rm.codice, descrizione: rm.descrizione, target: 0, fornito: 0, stock: rm.quantita_stock };
        acc[k].target  += rm.target;
        acc[k].fornito += rm.quantita_fornita;
        acc[k].stock    = rm.quantita_stock;   // giacenza corrente del materiale (uguale per tutte le righe)
    };
    const walk = lav => {
        (lav.rich_mat || []).forEach(add);
        (lav.figli || []).forEach(walk);
    };
    (macchina.lavorazioni || []).forEach(walk);
    (macchina.materiali_diretti || []).forEach(add);
    return Object.values(acc);
}

async function scaffaleOpenFactory(comm, cellId) {
    scaffaleFactoryComm = comm || null;
    scaffaleFactoryCell = cellId || null;
    document.getElementById('scaffalePopupOverlay').classList.add('open');
    // Cella senza commessa → primo passo: assegnazione (nello stesso pannello)
    if (!comm) { scaffaleRenderAssegna(cellId, null); return; }
    const col = scaffaleColoreCommessa(comm.id);
    const codiceEl = document.getElementById('spCodice');
    codiceEl.textContent = comm.codice || ('Commessa ' + comm.id);
    codiceEl.style.color = col.band;                                   // titolo nel colore della commessa
    document.querySelector('#scaffalePopupOverlay .sp-header').style.boxShadow = 'inset 0 4px 0 ' + col.border;
    document.getElementById('spDesc').textContent   = comm.descrizione || '';
    document.getElementById('spBody').innerHTML = '<div class="sp-loading"><i class="fa-solid fa-spinner fa-spin"></i> Caricamento...</div>';
    await scaffaleRefreshFactory();
}

async function scaffaleRefreshFactory() {
    if (!scaffaleFactoryComm) return;
    try {
        const albero = await scaffaleGet('/commesse/' + scaffaleFactoryComm.id + '/albero');
        scaffaleRenderFactory(albero);
    } catch {
        document.getElementById('spBody').innerHTML =
            '<div class="sp-loading" style="color:#d93025"><i class="fa-solid fa-triangle-exclamation"></i> Errore nel caricamento.</div>';
    }
}

function scaffaleRenderFactory(albero) {
    let h = '';
    h += `<div class="fb-toolbar">
        <span class="fb-cell-tag"><i class="fa-solid fa-location-dot"></i> ${scaffaleFactoryCell ? 'Cella ' + scaffaleFactoryCell : 'Commessa'}</span>
        <div class="fb-toolbar-actions">
            <button class="goto-btn" id="fbGotoGrafo" title="Apri il grafo di completamento della commessa"><i class="fa-solid fa-diagram-project"></i> Completamento</button>
            ${scaffaleFactoryCell ? '<button class="fb-change-comm" id="fbChangeComm"><i class="fa-solid fa-pen"></i> Cambia commessa</button>' : ''}
            ${scaffaleFactoryCell ? '<button class="fb-clear-cell" id="fbClearCell" title="Togli la commessa da questa cella"><i class="fa-solid fa-trash"></i> Svuota cella</button>' : ''}
        </div>
    </div>`;

    const macchine = albero.macchine || [];
    if (!macchine.length) {
        h += `<p style="font-size:13px;color:#bbb;padding:8px 4px;">Nessuna macchina associata alla commessa.</p>`;
    }
    macchine.forEach(m => {
        const mats = scaffaleAggregaMateriali(m);
        const completa = mats.length > 0 && mats.every(x => x.fornito >= x.target);
        h += `<div class="fb-macchina ${completa ? 'fb-ready' : ''}">
            <div class="fb-mac-header">
                <span class="fb-mac-codice"><i class="fa-solid fa-industry"></i> ${m.codice || '—'}</span>
                <span class="fb-mac-nome">${m.descrizione || ''}</span>
                <span class="badge badge-commessa">×${m.quantita ?? 1}</span>
                ${completa ? '<span class="fb-ready-badge"><i class="fa-solid fa-circle-check"></i> Pronta per produzione</span>' : ''}
            </div>`;
        if (!mats.length) {
            h += `<div class="fb-empty">Nessun materiale necessario.</div>`;
        } else {
            h += `<div class="fb-mat-list">`;
            mats.forEach(x => {
                const pct  = x.target > 0 ? Math.min(100, Math.round(100 * x.fornito / x.target)) : 100;
                const done = x.fornito >= x.target;
                h += `<div class="fb-mat-row ${done ? 'fb-mat-done' : ''}" data-cm="${m.commessa_macchina_id}" data-mat="${x.id_materiale}">
                    <div class="fb-mat-info">
                        <span class="fb-mat-codice">${x.codice || '—'}</span>
                        <span class="fb-mat-nome">${x.descrizione || ''}</span>
                    </div>
                    <div class="fb-mat-progress"><div class="fb-mat-fill ${done ? 'full' : ''}" style="width:${pct}%"></div></div>
                    <span class="fb-mat-count">${x.fornito}/${x.target}</span>
                    <span class="fb-mat-stock ${x.stock <= 0 ? 'danger' : ''}">disp. ${x.stock}</span>
                    <div class="fb-mat-actions">
                        <button class="fb-btn fb-btn-minus" title="Restituisci al magazzino" ${x.fornito <= 0 ? 'disabled' : ''}><i class="fa-solid fa-minus"></i></button>
                        <input type="number" class="fb-qty" value="1" min="1" step="1">
                        <button class="fb-btn fb-btn-plus" title="Preleva dal magazzino e assegna" ${(done || x.stock <= 0) ? 'disabled' : ''}><i class="fa-solid fa-plus"></i></button>
                    </div>
                </div>`;
            });
            h += `</div>`;
        }
        h += `</div>`;
    });

    const body = document.getElementById('spBody');
    body.innerHTML = h;

    const chg = document.getElementById('fbChangeComm');
    if (chg) chg.addEventListener('click', () => {
        // cambia commessa restando nello stesso pannello (step di assegnazione inline)
        scaffaleRenderAssegna(scaffaleFactoryCell, scaffaleFactoryComm);
    });
    const clr = document.getElementById('fbClearCell');
    if (clr) clr.addEventListener('click', async () => {
        if (!confirm('Vuoi togliere la commessa da questa cella? I materiali già preparati restano, la cella torna vuota.')) return;
        try { await scaffaleClearCella(scaffaleFactoryCell); }
        catch { alert('Impossibile svuotare la cella (errore di rete).'); return; }
        scaffaleBuildOverlay();
        scaffaleClosePopup();
    });
    const goto = document.getElementById('fbGotoGrafo');
    if (goto) goto.addEventListener('click', () => {
        if (scaffaleFactoryComm) window.location.href = 'magazzino.html?commessaGrafo=' + scaffaleFactoryComm.id;
    });
    body.querySelectorAll('.fb-mat-row').forEach(row => {
        const cm = row.dataset.cm, mat = row.dataset.mat;
        const qtyEl = row.querySelector('.fb-qty');
        row.querySelector('.fb-btn-plus').addEventListener('click', () => scaffaleAssegna(cm, mat, parseInt(qtyEl.value) || 1, true));
        row.querySelector('.fb-btn-minus').addEventListener('click', () => scaffaleAssegna(cm, mat, parseInt(qtyEl.value) || 1, false));
    });
}

async function scaffaleAssegna(cm, mat, qty, preleva) {
    if (!qty || qty < 1) qty = 1;
    const azione = preleva ? 'fornisci' : 'restituisci';
    try {
        const r = await fetch(API_BASE + '/commessa-macchine/' + cm + '/materiale/' + mat + '/' + azione, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token'), 'Content-Type': 'application/json' },
            body: JSON.stringify({ quantita: qty })
        });
        if (!r.ok) { const e = await r.json().catch(() => ({})); alert('Operazione non riuscita: ' + (e.errore || r.status)); return; }
        await scaffaleRefreshFactory();
    } catch {
        alert('Errore di rete.');
    }
}

// ── Ricerca: commesse + materiali ──────────────────────────────────

function scaffaleInitSearch() {
    const input    = document.getElementById('scaffaleSearchInput');
    const dropdown = document.getElementById('scaffaleSearchDropdown');
    if (!input || !dropdown) return;

    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        if (!q) { dropdown.classList.remove('open'); scaffaleClearHighlights(); return; }

        const hits = scaffaleCommesse.filter(c =>
            (c.codice || '').toLowerCase().includes(q) ||
            (c.descrizione || '').toLowerCase().includes(q)
        ).map(c => ({ tipo: 'commessa', data: c }));

        if (!hits.length) {
            dropdown.innerHTML = '<div class="ssd-empty">Nessun risultato trovato</div>';
        } else {
            dropdown.innerHTML = hits.map(h => `
                <div class="ssd-item" data-tipo="${h.tipo}" data-id="${h.data.id}">
                    <span class="ssd-tipo-badge ssd-badge-${h.tipo}">
                        <i class="fa-solid ${h.tipo === 'commessa' ? 'fa-file-invoice' : 'fa-box'}"></i>
                        ${h.tipo === 'commessa' ? 'Commessa' : 'Materiale'}
                    </span>
                    <span class="ssd-codice">${h.data.codice}</span>
                    <span class="ssd-desc">${h.data.descrizione || ''}</span>
                </div>`).join('');

            dropdown.querySelectorAll('.ssd-item').forEach(item => {
                item.addEventListener('click', () => {
                    const comm = scaffaleCommesse.find(c => String(c.id) === item.dataset.id);
                    if (comm) scaffaleOpenFactory(comm, null);
                    dropdown.classList.remove('open');
                    input.value = '';
                });
            });
        }
        dropdown.classList.add('open');
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('.scaffale-search-wrap')) dropdown.classList.remove('open');
    });
}

function scaffaleClearHighlights() {
    document.querySelectorAll('.shelf-cell.highlighted').forEach(c => c.classList.remove('highlighted'));
}

// I vecchi popup commessa/materiale sono stati sostituiti dal pannello "fabbrica" (scaffaleOpenFactory).

function scaffaleClosePopup() {
    document.getElementById('scaffalePopupOverlay').classList.remove('open');
    scaffaleFactoryComm = null;
    scaffaleFactoryCell = null;
    scaffaleActiveCellId = null;
    scaffaleClearHighlights();
}

// ── Inizializzazione ───────────────────────────────────────────────

async function scaffaleInit() {
    if (!document.getElementById('shelfOverlay')) return;

    try { scaffaleCommesse  = await scaffaleGet('/commesse'); }  catch { scaffaleCommesse = []; }
    try { scaffaleMateriali = await scaffaleGet('/materiale'); } catch { scaffaleMateriali = []; }
    await scaffaleFetchCelle();   // mappa cella→commessa dal DB

    scaffaleBuildOverlay();
    scaffaleInitSearch();

    // Pannello cella (unico): chiudi cliccando la X, lo sfondo o premendo Esc
    document.getElementById('spClose').addEventListener('click', scaffaleClosePopup);
    document.getElementById('scaffalePopupOverlay').addEventListener('click', e => {
        if (e.target === e.currentTarget) scaffaleClosePopup();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.getElementById('scaffalePopupOverlay').classList.contains('open')) scaffaleClosePopup();
    });

    // Arrivo da un link esterno (?commessa=<id>): apri direttamente la fabbrica della commessa
    const idc = new URLSearchParams(window.location.search).get('commessa');
    if (idc) {
        const comm = scaffaleCommesse.find(c => String(c.id) === String(idc));
        if (comm) {
            let cellId = null;
            Object.entries(scaffaleLoadCelle()).forEach(([cid, cel]) => {
                if (cel && cel.commessa && String(cel.commessa.id) === String(idc)) cellId = cid;
            });
            scaffaleOpenFactory(comm, cellId);
        }
    }
}

document.addEventListener('DOMContentLoaded', scaffaleInit);
