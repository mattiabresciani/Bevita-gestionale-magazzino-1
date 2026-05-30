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

    // Regola il comportamento del logout: pulisce localStorage e reindirizza a login.html
    const logoutBtn = document.getElementById('sidebar-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function (e) {
            e.preventDefault();
            localStorage.clear();
            window.location.href = 'login.html';
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

const SCAFFALE_KEY  = 'scaffalatura_celle';
const SCAFFALE_ROWS = ['D', 'C', 'B', 'A'];
const SCAFFALE_COLS = [1, 2, 3, 4, 5, 6, 7, 8];

let scaffaleCommesse     = [];
let scaffaleMateriali    = [];
let scaffaleActiveCellId = null;
let scaffaleTempMat      = [];   // materiali temporanei durante la modifica di una cella

// ── Dati localStorage ─────────────────────────────────────────────

// Migra il vecchio formato {id, codice, ...} al nuovo {commessa:{...}, materiali:[]}
function scaffaleMigraCella(val) {
    if (!val) return { commessa: null, materiali: [] };
    if (val.commessa !== undefined) return val;
    return { commessa: val, materiali: [] };
}

function scaffaleLoadCelle() {
    try {
        const raw = JSON.parse(localStorage.getItem(SCAFFALE_KEY)) || {};
        const out = {};
        Object.entries(raw).forEach(([k, v]) => { out[k] = scaffaleMigraCella(v); });
        return out;
    } catch { return {}; }
}

function scaffaleSaveCelle(c) {
    localStorage.setItem(SCAFFALE_KEY, JSON.stringify(c));
}

async function scaffaleGet(path) {
    const r = await fetch('http://localhost:5001' + path, {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    if (!r.ok) throw new Error(r.status);
    return r.json();
}

// ── Overlay celle sulla foto ───────────────────────────────────────

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
            const cella = celle[id];
            const comm  = cella?.commessa;
            const mats  = cella?.materiali || [];
            const occupied = comm || mats.length > 0;

            const cell = document.createElement('div');
            cell.className = 'shelf-cell' + (occupied ? ' occupied' : '');
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

            // Etichetta in basso: commessa + conteggio materiali
            const lbl = document.createElement('div');
            lbl.className = 'shelf-cell-label';

            const commLine = document.createElement('span');
            commLine.className = 'scl-comm';
            commLine.textContent = comm ? (comm.codice || 'N°' + comm.id) : '';
            lbl.appendChild(commLine);

            if (mats.length > 0) {
                const matLine = document.createElement('span');
                matLine.className = 'scl-mats';
                matLine.textContent = mats.length === 1 ? '1 materiale' : mats.length + ' materiali';
                lbl.appendChild(matLine);
            }

            if (occupied) cell.appendChild(lbl);

            cell.addEventListener('click', () => scaffaleOpenCellModal(id));
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

// ── Modal assegnazione cella ───────────────────────────────────────

function scaffaleOpenCellModal(id) {
    scaffaleActiveCellId = id;
    document.getElementById('caTitle').textContent = 'Cella ' + id;

    const celle = scaffaleLoadCelle();
    const cella = celle[id] || { commessa: null, materiali: [] };
    scaffaleTempMat = [...(cella.materiali || [])];

    // Genera il corpo del modal dinamicamente
    const body = document.getElementById('caBody');
    body.innerHTML = `
        <p class="ca-section-label">Commessa</p>
        <select class="ca-select" id="caSelect">
            <option value="">— Nessuna —</option>
            ${scaffaleCommesse.map(c =>
                `<option value="${c.id}" ${cella.commessa?.id == c.id ? 'selected' : ''}>
                    ${c.codice}${c.descrizione ? ' — ' + c.descrizione : ''}
                </option>`
            ).join('')}
        </select>

        <div class="ca-divider"></div>

        <p class="ca-section-label">Materiali nella cella</p>
        <div class="ca-mat-list" id="caMatList"></div>

        <div class="ca-add-mat-row">
            <select class="ca-mat-sel" id="caMatSel">
                <option value="">Seleziona materiale...</option>
                ${scaffaleMateriali.map(m =>
                    `<option value="${m.id}">${m.codice} — ${m.descrizione || ''}</option>`
                ).join('')}
            </select>
            <input type="number" id="caMatQty" class="ca-mat-qty-input" value="1" min="0.01" step="0.01" placeholder="Qt.">
            <button class="ca-mat-add-btn" id="caBtnAddMat"><i class="fa-solid fa-plus"></i></button>
        </div>
    `;

    scaffaleRenderMatList();
    document.getElementById('caBtnAddMat').addEventListener('click', scaffaleAddMatToTemp);
    document.getElementById('cellAssignOverlay').classList.add('open');
}

function scaffaleRenderMatList() {
    const list = document.getElementById('caMatList');
    if (!list) return;
    if (!scaffaleTempMat.length) {
        list.innerHTML = '<p class="ca-mat-empty">Nessun materiale aggiunto</p>';
        return;
    }
    list.innerHTML = scaffaleTempMat.map((m, i) => `
        <div class="ca-mat-row">
            <span class="ca-mat-codice">${m.codice}</span>
            <span class="ca-mat-nome">${m.descrizione || ''}</span>
            <span class="ca-mat-qty-tag">×${m.quantita}</span>
            <button class="ca-mat-remove" data-i="${i}"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('');

    list.querySelectorAll('.ca-mat-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            scaffaleTempMat.splice(Number(btn.dataset.i), 1);
            scaffaleRenderMatList();
        });
    });
}

function scaffaleAddMatToTemp() {
    const sel  = document.getElementById('caMatSel');
    const qtyEl = document.getElementById('caMatQty');
    if (!sel.value) return;
    const mat = scaffaleMateriali.find(m => String(m.id) === sel.value);
    if (!mat) return;
    const qty = parseFloat(qtyEl.value) || 1;
    const existing = scaffaleTempMat.find(m => m.id === mat.id);
    if (existing) {
        existing.quantita = parseFloat((existing.quantita + qty).toFixed(4));
    } else {
        scaffaleTempMat.push({ id: mat.id, codice: mat.codice, descrizione: mat.descrizione, quantita: qty });
    }
    sel.value = '';
    qtyEl.value = '1';
    scaffaleRenderMatList();
}

function scaffaleCloseCellModal() {
    document.getElementById('cellAssignOverlay').classList.remove('open');
    scaffaleActiveCellId = null;
    scaffaleTempMat = [];
}

// ── Ricerca: commesse + materiali ──────────────────────────────────

function scaffaleInitSearch() {
    const input    = document.getElementById('scaffaleSearchInput');
    const dropdown = document.getElementById('scaffaleSearchDropdown');
    if (!input || !dropdown) return;

    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        if (!q) { dropdown.classList.remove('open'); scaffaleClearHighlights(); return; }

        const commHits = scaffaleCommesse.filter(c =>
            (c.codice || '').toLowerCase().includes(q) ||
            (c.descrizione || '').toLowerCase().includes(q)
        ).map(c => ({ tipo: 'commessa', data: c }));

        const matHits = scaffaleMateriali.filter(m =>
            (m.codice || '').toLowerCase().includes(q) ||
            (m.descrizione || '').toLowerCase().includes(q)
        ).map(m => ({ tipo: 'materiale', data: m }));

        const hits = [...commHits, ...matHits];

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
                    if (item.dataset.tipo === 'commessa') {
                        const comm = scaffaleCommesse.find(c => String(c.id) === item.dataset.id);
                        if (comm) scaffaleOpenCommessaPopup(comm);
                    } else {
                        const mat = scaffaleMateriali.find(m => String(m.id) === item.dataset.id);
                        if (mat) scaffaleOpenMaterialePopup(mat);
                    }
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

// ── Popup commessa ─────────────────────────────────────────────────

async function scaffaleOpenCommessaPopup(comm) {
    document.getElementById('spCodice').textContent = comm.codice;
    document.getElementById('spDesc').textContent   = comm.descrizione || '';
    document.getElementById('spBody').innerHTML =
        '<div class="sp-loading"><i class="fa-solid fa-spinner fa-spin"></i> Caricamento...</div>';
    document.getElementById('scaffalePopupOverlay').classList.add('open');

    scaffaleClearHighlights();
    const celle = scaffaleLoadCelle();
    const celleOcc = [];
    Object.entries(celle).forEach(([cId, cella]) => {
        if (cella?.commessa?.id === comm.id) {
            celleOcc.push(cId);
            const el = document.querySelector(`.shelf-cell[data-id="${cId}"]`);
            if (el) el.classList.add('highlighted');
        }
    });

    try {
        const macchine = await scaffaleGet(`/commesse/${comm.id}/macchine`);
        const macchineConMat = await Promise.all(
            macchine.map(async m => ({
                ...m,
                materiali: await scaffaleGet(`/macchine/${m.id_macchina}/materiali`)
            }))
        );
        scaffaleRenderCommessaPopup(comm, celleOcc, macchineConMat);
    } catch {
        document.getElementById('spBody').innerHTML =
            '<div class="sp-loading" style="color:#d93025"><i class="fa-solid fa-triangle-exclamation"></i> Errore nel caricamento.</div>';
    }
}

function scaffaleRenderCommessaPopup(comm, celleOcc, macchineConMat) {
    let h = '';

    h += `<div class="sp-section">
        <div class="sp-section-title"><i class="fa-solid fa-location-dot"></i> Celle in scaffale</div>
        <div class="sp-celle-chips">
            ${!celleOcc.length
                ? '<span class="sp-cella-chip empty">Nessuna cella assegnata</span>'
                : celleOcc.sort().map(id => `<span class="sp-cella-chip">${id}</span>`).join('')}
        </div></div>`;

    h += `<div class="sp-section">
        <div class="sp-section-title"><i class="fa-solid fa-circle-info"></i> Dettagli commessa</div>
        <div class="sp-badges">
            <span class="badge ${comm.stato === 'APERTA' ? 'badge-aperta' : 'badge-chiusa'}">${comm.stato || '—'}</span>
            ${comm.anno ? `<span class="badge">${comm.anno}</span>` : ''}
        </div></div>`;

    h += `<div class="sp-section">
        <div class="sp-section-title"><i class="fa-solid fa-industry"></i> Macchine e Materiali necessari</div>`;

    if (!macchineConMat.length) {
        h += `<p style="font-size:13px;color:#bbb;">Nessuna macchina associata.</p>`;
    } else {
        macchineConMat.forEach(m => {
            h += `<div class="sp-macchina-block">
                <div class="sp-macchina-header">
                    <span class="sp-mac-codice">${m.codice || '—'}</span>
                    <span class="sp-mac-nome">${m.descrizione || ''}</span>
                    <span class="sp-mac-qty">Qtà ${m.quantita ?? '—'}</span>
                </div>`;
            if (!m.materiali.length) {
                h += `<div style="padding:10px 14px;font-size:12px;color:#bbb;">Nessun materiale associato</div>`;
            } else {
                h += `<div class="sp-materiali-list">`;
                m.materiali.forEach(mat => {
                    const s = mat.quantita_stock, n = mat.quantita_necessaria;
                    const cls   = s <= 0 ? 'danger' : s < n ? 'warn' : 'ok';
                    const label = s <= 0 ? 'Esaurito' : s < n ? 'Scarso' : 'Disponibile';
                    h += `<div class="sp-mat-row">
                        <div class="sp-mat-dot"></div>
                        <span class="sp-mat-codice">${mat.codice || '—'}</span>
                        <span class="sp-mat-nome">${mat.descrizione || ''}</span>
                        <span class="sp-mat-qty">×${n}</span>
                        <span class="sp-mat-stock ${cls}">Stock: ${s} · ${label}</span>
                    </div>`;
                });
                h += `</div>`;
            }
            h += `</div>`;
        });
    }
    h += `</div>`;
    document.getElementById('spBody').innerHTML = h;
}

// ── Popup materiale ────────────────────────────────────────────────

async function scaffaleOpenMaterialePopup(mat) {
    document.getElementById('spCodice').textContent = mat.codice;
    document.getElementById('spDesc').textContent   = mat.descrizione || '';
    document.getElementById('spBody').innerHTML =
        '<div class="sp-loading"><i class="fa-solid fa-spinner fa-spin"></i> Ricerca in corso...</div>';
    document.getElementById('scaffalePopupOverlay').classList.add('open');

    scaffaleClearHighlights();

    // Celle in cui è fisicamente presente (localStorage)
    const celle = scaffaleLoadCelle();
    const celleConMat = [];
    Object.entries(celle).forEach(([cId, cella]) => {
        if (!cella) return;
        const trovato = (cella.materiali || []).find(m => m.id === mat.id);
        if (trovato) {
            celleConMat.push({ cellId: cId, commessa: cella.commessa, quantita: trovato.quantita });
            const el = document.querySelector(`.shelf-cell[data-id="${cId}"]`);
            if (el) el.classList.add('highlighted');
        }
    });

    // Commesse che lo richiedono (API)
    try {
        const commesseCheLaUsano = [];
        for (const comm of scaffaleCommesse) {
            const macchine = await scaffaleGet(`/commesse/${comm.id}/macchine`);
            for (const mac of macchine) {
                const materiali = await scaffaleGet(`/macchine/${mac.id_macchina}/materiali`);
                const found = materiali.find(m => m.id === mat.id);
                if (found) commesseCheLaUsano.push({ commessa: comm, macchina: mac, quantita: found.quantita_necessaria });
            }
        }
        scaffaleRenderMaterialePopup(mat, celleConMat, commesseCheLaUsano);
    } catch {
        document.getElementById('spBody').innerHTML =
            '<div class="sp-loading" style="color:#d93025"><i class="fa-solid fa-triangle-exclamation"></i> Errore nel caricamento.</div>';
    }
}

function scaffaleRenderMaterialePopup(mat, celleConMat, commesseCheLaUsano) {
    let h = '';

    // Celle dove è fisicamente presente
    h += `<div class="sp-section">
        <div class="sp-section-title"><i class="fa-solid fa-location-dot"></i> Presente nelle celle</div>`;
    if (!celleConMat.length) {
        h += `<p style="font-size:13px;color:#bbb;">Non presente in nessuna cella dello scaffale.</p>`;
    } else {
        h += `<div style="display:flex;flex-direction:column;gap:6px;">`;
        celleConMat.sort((a, b) => a.cellId.localeCompare(b.cellId)).forEach(c => {
            h += `<div class="sp-mat-cella-row">
                <span class="sp-cella-chip">${c.cellId}</span>
                <span class="sp-mat-cella-info">
                    ${c.commessa ? `<span class="badge">${c.commessa.codice}</span>` : '<span style="color:#bbb;font-size:12px;">senza commessa</span>'}
                    <span style="font-size:12px;color:#555;margin-left:6px;">× ${c.quantita} pz</span>
                </span>
            </div>`;
        });
        h += `</div>`;
    }
    h += `</div>`;

    // Commesse che lo richiedono
    h += `<div class="sp-section">
        <div class="sp-section-title"><i class="fa-solid fa-industry"></i> Richiesto nelle commesse</div>`;
    if (!commesseCheLaUsano.length) {
        h += `<p style="font-size:13px;color:#bbb;">Non richiesto in nessuna commessa.</p>`;
    } else {
        h += `<div class="sp-materiali-list">`;
        commesseCheLaUsano.forEach(c => {
            h += `<div class="sp-mat-row">
                <div class="sp-mat-dot"></div>
                <span class="sp-mat-codice">${c.commessa.codice}</span>
                <span class="sp-mat-nome">Macchina: ${c.macchina.codice}</span>
                <span class="sp-mat-qty">×${c.quantita}</span>
                <span class="badge ${c.commessa.stato === 'APERTA' ? 'badge-aperta' : 'badge-chiusa'}">${c.commessa.stato}</span>
            </div>`;
        });
        h += `</div>`;
    }
    h += `</div>`;

    document.getElementById('spBody').innerHTML = h;
}

function scaffaleClosePopup() {
    document.getElementById('scaffalePopupOverlay').classList.remove('open');
    scaffaleClearHighlights();
}

// ── Inizializzazione ───────────────────────────────────────────────

async function scaffaleInit() {
    if (!document.getElementById('shelfOverlay')) return;

    try { scaffaleCommesse  = await scaffaleGet('/commesse'); }  catch { scaffaleCommesse = []; }
    try { scaffaleMateriali = await scaffaleGet('/materiale'); } catch { scaffaleMateriali = []; }

    scaffaleBuildOverlay();
    scaffaleInitSearch();

    // Modal cella: chiudi
    document.getElementById('caClose').addEventListener('click', scaffaleCloseCellModal);
    document.getElementById('cellAssignOverlay').addEventListener('click', e => {
        if (e.target === e.currentTarget) scaffaleCloseCellModal();
    });

    // Modal cella: svuota
    document.getElementById('caBtnClear').addEventListener('click', () => {
        if (!scaffaleActiveCellId) return;
        const celle = scaffaleLoadCelle();
        delete celle[scaffaleActiveCellId];
        scaffaleSaveCelle(celle);
        scaffaleBuildOverlay();
        scaffaleCloseCellModal();
    });

    // Modal cella: salva commessa + materiali
    document.getElementById('caBtnSave').addEventListener('click', () => {
        if (!scaffaleActiveCellId) return;
        const sel   = document.getElementById('caSelect');
        const celle = scaffaleLoadCelle();
        const comm  = sel?.value ? scaffaleCommesse.find(c => String(c.id) === sel.value) : null;

        if (!comm && !scaffaleTempMat.length) {
            delete celle[scaffaleActiveCellId];
        } else {
            celle[scaffaleActiveCellId] = {
                commessa: comm ? { id: comm.id, codice: comm.codice, descrizione: comm.descrizione, stato: comm.stato, anno: comm.anno } : null,
                materiali: scaffaleTempMat
            };
        }
        scaffaleSaveCelle(celle);
        scaffaleBuildOverlay();
        scaffaleCloseCellModal();
    });

    // Popup: chiudi
    document.getElementById('spClose').addEventListener('click', scaffaleClosePopup);
    document.getElementById('scaffalePopupOverlay').addEventListener('click', e => {
        if (e.target === e.currentTarget) scaffaleClosePopup();
    });
}

document.addEventListener('DOMContentLoaded', scaffaleInit);
