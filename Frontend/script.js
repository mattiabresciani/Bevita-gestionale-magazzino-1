// Usa lo stesso host della pagina (localhost o 127.0.0.1) per evitare mismatch di origine
const API = window.BACKEND_URL;
const token = localStorage.getItem('token');
if (!token) window.location.href = 'login.html';

let sezioneCorrente = 'commesse';

// ── UTILITY ───────────────────────────────────────────────────────────────────

// Escape HTML: da usare SEMPRE quando si inseriscono dati (codici, descrizioni, ecc.)
// dentro innerHTML o attributi, per prevenire XSS persistente.
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function apiFetch(path, method = 'GET', body = null) {
    const opts = {
        method,
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API + path, opts);
    if (res.status === 401) {
        localStorage.removeItem('token');   // coerente con logoutUtente(): rimuove solo il token
        window.location.href = 'login.html';
        return null;
    }
    return res;
}

function statoClass(stato) {
    if (stato === 'COMPLETATA' || stato === 'IN_MAGAZZINO') return 'badge-completata';
    if (stato === 'IN_CORSO')   return 'badge-corso';
    return 'badge-attesa';   // IN_ATTESA / DA_PRODURRE
}

// Etichetta leggibile dello stato di una macchina in commessa
function labelStatoMacchina(stato) {
    if (stato === 'IN_MAGAZZINO') return 'In magazzino';
    if (stato === 'DA_PRODURRE')  return 'Da produrre';
    return stato ?? '-';
}

// Colore distinto e stabile per ogni lavorazione (stesso nome processo = stesso colore)
const _PALETTA_LAV = [
    { bg: '#ffe2e2', border: '#e57373' }, { bg: '#e3f0fd', border: '#5c9ded' },
    { bg: '#e6f6e9', border: '#66bb6a' }, { bg: '#fff1da', border: '#ffa726' },
    { bg: '#f3e6fb', border: '#ab57c9' }, { bg: '#e0f5f2', border: '#26a69a' },
    { bg: '#fde4ef', border: '#ec5f9b' }, { bg: '#e7e9fb', border: '#7986cb' },
    { bg: '#efe6e1', border: '#a1887f' }, { bg: '#eef7df', border: '#9ccc65' },
    { bg: '#e1f5fe', border: '#29b6f6' }, { bg: '#ffe9e0', border: '#ff8a65' }
];
function coloreLavorazione(key) {
    const s = String(key ?? '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return _PALETTA_LAV[h % _PALETTA_LAV.length];
}

// Il combobox con ricerca `creaAutocomplete` è definito in framework.js (caricato su
// tutte le pagine), così è condiviso tra gestionale e scaffalatura.

// ── RICERCA ───────────────────────────────────────────────────────────────────

document.getElementById('searchInput').addEventListener('input', function () {
    const q = this.value.toLowerCase().trim();
    document.querySelectorAll('.commessa-card-accordion, .commessa-card').forEach(card => {
        const codeEl = card.querySelector('.item-code');
        let testo = codeEl ? codeEl.textContent : '';
        try {
            const rec = JSON.parse(card.dataset.record || '{}');
            testo += ' ' + (rec.codice ?? '') + ' ' + (rec.descrizione ?? '');
        } catch (e) {}
        card.style.display = testo.toLowerCase().includes(q) ? '' : 'none';
    });
});

// ── PILL BUTTONS ──────────────────────────────────────────────────────────────

document.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        sezioneCorrente = btn.dataset.target;
        document.getElementById('pageTitle').textContent = btn.textContent;
        document.getElementById('searchInput').value = '';
        caricaSezione(sezioneCorrente);
    });
});

// ── CARICA SEZIONE PRINCIPALE ─────────────────────────────────────────────────

async function caricaSezione(sezione) {
    const container = document.getElementById('cards-container');
    container.innerHTML = '<p class="loading-msg">Caricamento...</p>';

    const endpoints = {
        'commesse': '/commesse', 'macchine': '/macchine',
        'lavorazioni': '/processi', 'semilavorati': '/semilavorati', 'materie-prime': '/materiale'
    };
    const res = await apiFetch(endpoints[sezione]);
    if (!res) return;

    const dati = await res.json();
    container.innerHTML = '';

    if (!dati.length) {
        container.innerHTML = '<p class="loading-msg">Nessun elemento trovato.</p>';
        return;
    }

    if (sezione === 'commesse')         renderCommesse(dati, container);
    else if (sezione === 'macchine')    renderMacchine(dati, container);
    else if (sezione === 'lavorazioni') renderLavorazioni(dati, container);
    else if (sezione === 'semilavorati') renderSemilavorati(dati, container);
    else if (sezione === 'materie-prime') renderMateriale(dati, container);

    attaccaEventiCard();
}

// ── RENDER COMMESSE ───────────────────────────────────────────────────────────

function renderCommesse(dati, container) {
    const renderUna = (c, target) => {
        const statoClass = c.stato === 'CHIUSA' ? 'badge badge-chiusa' : 'badge badge-aperta';
        const div = document.createElement('div');
        div.className = 'commessa-card-accordion';
        div.dataset.id = c.id ?? '';
        div.dataset.record = JSON.stringify(c);
        div.dataset.sezione = 'commesse';
        div.innerHTML =
            '<div class="accordion-header">' +
                '<span class="accordion-arrow">&#x203A;</span>' +
                '<span class="item-code commessa-code">' + esc(c.codice ?? '-') + '</span>' +
                '<div class="accordion-badges">' +
                    '<span class="card-desc">' + esc(c.descrizione ?? '-') + '</span>' +
                    '<span class="badge">' + esc(c.anno ?? '-') + '</span>' +
                    (c.data_consegna ? '<span class="badge"><i class="fa-regular fa-calendar"></i> ' + esc(c.data_consegna) + '</span>' : '') +
                    '<span class="' + statoClass + '">' + esc(c.stato ?? '-') + '</span>' +
                '</div>' +
                '<div class="card-progress" title="Avanzamento commessa">' +
                    '<div class="card-progress-track"><div class="card-progress-fill ' + ((c.progresso ?? 0) >= 100 ? 'cpf-done' : '') + '" style="width:' + (c.progresso ?? 0) + '%"></div></div>' +
                    '<span class="card-progress-label">' + (c.progresso ?? 0) + '%</span>' +
                '</div>' +
                '<div class="card-actions">' +
                    '<button class="action-btn btn-grafo-commessa" title="Vista operativa (lavorazioni)"><i class="fa-solid fa-diagram-project"></i></button>' +
                    '<button class="action-btn edit-btn btn-modifica" title="Modifica"><i class="fa-solid fa-pen"></i></button>' +
                    '<button class="action-btn delete-btn btn-elimina" title="Elimina"><i class="fa-solid fa-trash"></i></button>' +
                '</div>' +
            '</div>' +
            '<div class="accordion-panel">' +
                '<div class="tree-container" id="tree-commessa-' + c.id + '">' +
                    '<p class="tree-empty">Apri per vedere le macchine associate.</p>' +
                '</div>' +
            '</div>';
        target.appendChild(div);

        div.querySelector('.btn-grafo-commessa').addEventListener('click', function(e) {
            e.stopPropagation();
            apriVistaCommessa(c);
        });
        div.querySelector('.accordion-header').addEventListener('click', function(e) {
            if (!e.target.closest('.card-actions')) {
                toggleAccordion(this);
                if (div.classList.contains('active')) caricaMacchineCommessa(c.id);
            }
        });
    };

    // In corso / incomplete sopra; completate (100%) dentro un riquadro verde sotto
    const inCorso    = dati.filter(c => (c.progresso ?? 0) < 100);
    const completate = dati.filter(c => (c.progresso ?? 0) >= 100);

    inCorso.forEach(c => renderUna(c, container));
    if (completate.length) {
        const box = document.createElement('div');
        box.className = 'completate-box';
        const hdr = document.createElement('div');
        hdr.className = 'completate-box-header';
        hdr.innerHTML = '<i class="fa-solid fa-circle-check"></i> Completate (' + completate.length + ')';
        box.appendChild(hdr);
        completate.forEach(c => renderUna(c, box));
        container.appendChild(box);
    }
}

// ── RENDER MACCHINE ───────────────────────────────────────────────────────────

function renderMacchine(dati, container) {
    const hdr = document.createElement('div');
    hdr.className = 'cards-col-header header-mac';
    hdr.innerHTML =
        '<span class="th-arrow-spacer"></span>' +
        '<span class="th th-codice">Codice</span>' +
        '<span class="th th-desc">Descrizione</span>' +
        '<span class="th th-act">Azioni</span>';
    container.appendChild(hdr);

    dati.forEach(m => {
        const div = document.createElement('div');
        div.className = 'commessa-card-accordion';
        div.dataset.id = m.id ?? '';
        div.dataset.record = JSON.stringify(m);
        div.dataset.sezione = 'macchine';
        div.innerHTML =
            '<div class="accordion-header">' +
                '<span class="accordion-arrow">&#x203A;</span>' +
                '<button class="item-code commessa-code machine-link-btn" title="Apri scheda">' + esc(m.codice ?? '-') + '</button>' +
                '<div class="accordion-badges">' +
                    '<span class="card-desc">' + esc(m.descrizione ?? '-') + '</span>' +
                '</div>' +
                '<div class="card-actions">' +
                    '<button class="action-btn edit-btn btn-modifica" title="Modifica"><i class="fa-solid fa-pen"></i></button>' +
                    '<button class="action-btn delete-btn btn-elimina" title="Elimina"><i class="fa-solid fa-trash"></i></button>' +
                '</div>' +
            '</div>' +
            '<div class="accordion-panel">' +
                '<div class="tree-container" id="tree-macchina-' + m.id + '">' +
                    '<p class="tree-empty">Apri per vedere le lavorazioni.</p>' +
                '</div>' +
            '</div>';
        container.appendChild(div);

        div.querySelector('.machine-link-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            apriSchedaMacchina(m);
        });
        div.querySelector('.accordion-header').addEventListener('click', function(e) {
            if (!e.target.closest('.card-actions') && !e.target.closest('.machine-link-btn')) {
                toggleAccordion(this);
                if (div.classList.contains('active')) caricaLavorazioniMacchina(m.id);
            }
        });
    });
}

// ── RENDER LAVORAZIONI ────────────────────────────────────────────────────────

// Catalogo CONDIVISO dei processi (solo descrizione). Le macchine li riusano nel grafo.
function renderLavorazioni(dati, container) {
    const hdr = document.createElement('div');
    hdr.className = 'cards-col-header header-mat';
    hdr.innerHTML =
        '<span class="th th-desc">Processo</span>' +
        '<span class="th th-act">Azioni</span>';
    container.appendChild(hdr);

    dati.forEach(p => {
        const div = document.createElement('div');
        div.className = 'commessa-card';
        div.dataset.id = p.id ?? '';
        div.dataset.record = JSON.stringify(p);
        div.dataset.sezione = 'lavorazioni';
        div.innerHTML =
            '<div class="card-left">' +
                '<span class="item-code commessa-code">' + esc(p.descrizione ?? '-') + '</span>' +
            '</div>' +
            '<div class="card-right"></div>' +
            '<div class="card-actions card-actions-right">' +
                '<button class="action-btn edit-btn btn-modifica" title="Modifica"><i class="fa-solid fa-pen"></i></button>' +
                '<button class="action-btn delete-btn btn-elimina" title="Elimina"><i class="fa-solid fa-trash"></i></button>' +
            '</div>';
        container.appendChild(div);
    });
}

// ── RENDER SEMILAVORATI (catalogo: lavorazione + componenti) ──────────────────

function renderSemilavorati(dati, container) {
    dati.forEach(s => {
        const div = document.createElement('div');
        div.className = 'commessa-card-accordion';
        div.dataset.id = s.id ?? '';
        div.dataset.record = JSON.stringify(s);
        div.dataset.sezione = 'semilavorati';
        // tag del processo (lavorazione) con colore distinto per ogni processo
        const pc = s.processo ? coloreLavorazione(s.processo) : { bg: '#f0f0f0', border: '#9e9e9e' };
        const procStyle = 'background:' + pc.bg + ';border:1px solid ' + pc.border + ';color:' + pc.border + ';font-weight:600;';
        div.innerHTML =
            '<div class="accordion-header">' +
                '<span class="accordion-arrow">&#x203A;</span>' +
                '<span class="item-code commessa-code">' + esc(s.codice || s.descrizione || '-') + '</span>' +
                '<div class="accordion-badges">' +
                    '<span class="card-desc">' + esc(s.descrizione ?? '-') + '</span>' +
                    '<span class="badge" style="' + procStyle + '"><i class="fa-solid fa-screwdriver-wrench"></i> ' + esc(s.processo ?? 'processo non impostato') + '</span>' +
                '</div>' +
                '<div class="card-actions">' +
                    '<button class="action-btn edit-btn btn-modifica" title="Modifica"><i class="fa-solid fa-pen"></i></button>' +
                    '<button class="action-btn delete-btn btn-elimina" title="Elimina"><i class="fa-solid fa-trash"></i></button>' +
                '</div>' +
            '</div>' +
            '<div class="accordion-panel">' +
                '<div class="tree-container" id="tree-semilav-' + s.id + '">' +
                    '<p class="tree-empty">Apri per impostare lavorazione e componenti.</p>' +
                '</div>' +
            '</div>';
        container.appendChild(div);

        div.querySelector('.accordion-header').addEventListener('click', function(e) {
            if (!e.target.closest('.card-actions')) {
                toggleAccordion(this);
                if (div.classList.contains('active')) caricaRicettaSemilavorato(s.id);
            }
        });
    });
}

async function caricaRicettaSemilavorato(idSem) {
    const tree = document.getElementById('tree-semilav-' + idSem);
    if (!tree) return;
    tree.innerHTML = '<p class="tree-empty">Caricamento...</p>';

    const [pr, comp, mat, sl] = await Promise.all([
        apiFetch('/processi'), apiFetch('/semilavorati/' + idSem + '/componenti'),
        apiFetch('/materiale'), apiFetch('/semilavorati')
    ]);
    const processi  = (pr && pr.ok) ? await pr.json() : [];
    const componenti = (comp && comp.ok) ? await comp.json() : [];
    const materiali = (mat && mat.ok) ? await mat.json() : [];
    const semilav   = (sl && sl.ok) ? await sl.json() : [];

    // record corrente (per id_processo attuale)
    const card = tree.closest('[data-record]');
    const rec = card ? JSON.parse(card.dataset.record) : {};

    tree.innerHTML = '';

    // 1) Selettore lavorazione (processo) del semilavorato
    const procRow = document.createElement('div');
    procRow.className = 'tree-add-row';
    const procLabel = document.createElement('label');
    procLabel.style.cssText = 'font-size:13px;color:#555;';
    procLabel.textContent = 'Lavorazione:';
    procRow.appendChild(procLabel);
    const procCombo = creaAutocomplete(
        processi.map(p => ({ value: String(p.id), label: p.descrizione ?? '-' })),
        '— Seleziona processo —',
        { id: 'sl-proc-' + idSem, value: rec.id_processo, wide: true,
          onChange: async o => {
              await apiFetch('/semilavorati/' + idSem, 'PUT', { id_processo: o ? Number(o.value) : null });
              caricaSezione('semilavorati');
          } });
    procRow.appendChild(procCombo);
    tree.appendChild(procRow);

    // 2) Lista componenti
    if (componenti.length) {
        const branch = document.createElement('div');
        branch.className = 'tree-branch';
        branch.appendChild(Object.assign(document.createElement('span'), { className: 'tree-line' }));
        componenti.forEach(co => {
            const item = document.createElement('div');
            item.className = 'tree-item';
            const tag = co.tipo === 'semilavorato' ? '<span class="badge badge-commessa">semilav.</span>' : '';
            item.innerHTML =
                '<span class="tree-dot">&#9632;</span>' +
                '<span class="material-code">' + esc(co.codice || co.descrizione || '-') + '</span> ' + tag +
                '<span class="material-quantity">×' + co.quantita + '</span>' +
                '<button class="action-btn delete-btn btn-rimuovi-comp" data-id="' + co.id + '" title="Rimuovi"><i class="fa-solid fa-trash"></i></button>';
            item.querySelector('.btn-rimuovi-comp').addEventListener('click', async function() {
                const r = await apiFetch('/semilavorato_componenti/' + this.dataset.id, 'DELETE');
                if (r && r.ok) caricaRicettaSemilavorato(idSem);
            });
            branch.appendChild(item);
        });
        tree.appendChild(branch);
    } else {
        tree.insertAdjacentHTML('beforeend', '<p class="tree-empty">Nessun componente. Aggiungine sotto.</p>');
    }

    // 3) Form aggiunta componente — barra di ricerca con elenco filtrato
    const opzioni = materiali.map(m => ({ value: 'm' + m.id, label: (m.codice ?? '-') + ' — ' + (m.descrizione ?? ''), tag: 'materia prima' }))
        .concat(semilav.filter(x => x.id !== idSem).map(x => ({ value: 's' + x.id, label: (x.codice || x.descrizione || '-'), tag: 'semilavorato' })));

    const addRow = document.createElement('div');
    addRow.className = 'tree-add-row';
    const combo = creaAutocomplete(opzioni, 'Cerca materia prima o semilavorato...');
    combo.classList.add('ac-wide');
    const qtyInput = document.createElement('input');
    qtyInput.type = 'number'; qtyInput.className = 'tree-input tree-input-sm'; qtyInput.value = '1'; qtyInput.min = '0.01'; qtyInput.step = '0.01';
    const addBtn = document.createElement('button');
    addBtn.className = 'bom-confirm-btn'; addBtn.title = 'Aggiungi'; addBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
    addRow.appendChild(combo);
    addRow.appendChild(qtyInput);
    addRow.appendChild(addBtn);
    tree.appendChild(addRow);

    addBtn.addEventListener('click', async function() {
        const sel = combo.getValore();
        if (!sel) { combo.querySelector('.ac-input').focus(); return; }
        const qty = parseFloat(qtyInput.value) || 1;
        const body = { quantita: qty };
        if (sel.value[0] === 'm') body.id_materiale = Number(sel.value.slice(1));
        else body.id_semilavorato_comp = Number(sel.value.slice(1));
        const r = await apiFetch('/semilavorati/' + idSem + '/componenti', 'POST', body);
        if (r && (r.ok || r.status === 201)) caricaRicettaSemilavorato(idSem);
        else if (r) { const e = await r.json().catch(() => ({})); alert('Errore: ' + (e.errore || r.status)); }
    });

    aggiornaAltezzaPanel(tree);
}

// ── RENDER MATERIE PRIME ──────────────────────────────────────────────────────

function qtyClass(qty) {
    const q = Number(qty) || 0;
    if (q === 0)  return 'qty-danger';
    if (q < 10)   return 'qty-warn';
    return '';
}

function renderMateriale(dati, container) {
    // Tasto unico: apre la modalità "Aggiorna giacenze" su TUTTE le voci
    const toolbar = document.createElement('div');
    toolbar.className = 'mat-toolbar';
    toolbar.innerHTML = '<button class="giac-bulk-btn"><i class="fa-solid fa-boxes-stacked"></i> Aggiorna giacenze</button>';
    container.appendChild(toolbar);
    toolbar.querySelector('.giac-bulk-btn').addEventListener('click', () => apriPopupGiacenze(dati));

    const hdr = document.createElement('div');
    hdr.className = 'cards-col-header header-mat';
    hdr.innerHTML =
        '<span class="th th-codice">Codice</span>' +
        '<span class="th th-desc">Descrizione</span>' +
        '<span class="th th-qty">Qtà</span>' +
        '<span class="th th-act">Azioni</span>';
    container.appendChild(hdr);

    dati.forEach(m => {
        const div = document.createElement('div');
        div.className = 'commessa-card';
        div.dataset.id = m.id ?? '';
        div.dataset.record = JSON.stringify(m);
        div.dataset.sezione = 'materie-prime';
        div.innerHTML =
            '<div class="card-left">' +
                '<span class="item-code commessa-code">' + esc(m.codice ?? '-') + '</span>' +
            '</div>' +
            '<div class="card-right">' +
                '<span class="card-desc">' + esc(m.descrizione ?? '-') + '</span>' +
            '</div>' +
            '<span class="qty-display ' + qtyClass(m.quantita) + '">' + (m.quantita ?? 0) + '</span>' +
            '<div class="card-actions card-actions-right">' +
                '<button class="action-btn edit-btn btn-modifica" title="Modifica"><i class="fa-solid fa-pen"></i></button>' +
                '<button class="action-btn delete-btn btn-elimina" title="Elimina"><i class="fa-solid fa-trash"></i></button>' +
            '</div>';
        container.appendChild(div);
    });
}

// Modalità "Aggiorna giacenze": una lista di tutte le materie prime, modificabili in blocco, con salvataggio unico
function apriPopupGiacenze(materiali) {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay open';
    ov.innerHTML =
        '<div class="modal modal-giacenze">' +
            '<div class="modal-header"><h3><i class="fa-solid fa-boxes-stacked"></i> Aggiorna giacenze</h3>' +
                '<button class="modal-close"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div class="modal-body">' +
                '<input type="text" id="giacFiltro" class="giac-filtro" placeholder="Filtra per codice o descrizione...">' +
                '<div class="giac-list" id="giacList"></div>' +
            '</div>' +
            '<div class="modal-footer">' +
                '<span class="giac-count" id="giacCount"></span>' +
                '<button class="modal-btn-cancel">Annulla</button>' +
                '<button class="modal-btn-save">Salva tutto</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(ov);

    const listEl = ov.querySelector('#giacList');
    const countEl = ov.querySelector('#giacCount');

    function aggiornaCount() {
        const n = listEl.querySelectorAll('.giac-rowm.giac-changed').length;
        countEl.textContent = n ? (n + ' modifica' + (n > 1 ? 'he' : '')) : '';
    }

    materiali.forEach(m => {
        const orig = Number(m.quantita) || 0;
        const row = document.createElement('div');
        row.className = 'giac-rowm';
        row.dataset.id = m.id;
        row.dataset.orig = orig;
        row.innerHTML =
            '<div class="giac-rowm-info">' +
                '<span class="giac-rowm-cod">' + esc(m.codice ?? '-') + '</span>' +
                '<span class="giac-rowm-desc">' + esc(m.descrizione ?? '') + '</span>' +
            '</div>' +
            '<div class="giac-rowm-step">' +
                '<input type="number" class="giac-rowm-amt" value="1" min="1" step="1" title="Quantità da aggiungere/togliere">' +
                '<button class="giac-mini" data-s="-1" title="Togli">−</button>' +
                '<input type="number" class="giac-rowm-val" value="' + orig + '" min="0" step="1" title="Giacenza">' +
                '<button class="giac-mini giac-up-btn" data-s="1" title="Aggiungi">+</button>' +
            '</div>';
        listEl.appendChild(row);

        const val = row.querySelector('.giac-rowm-val');
        const amt = row.querySelector('.giac-rowm-amt');
        const mark = () => { row.classList.toggle('giac-changed', (parseInt(val.value) || 0) !== orig); aggiornaCount(); };
        row.querySelectorAll('.giac-mini').forEach(b => b.addEventListener('click', () => {
            const passo = Math.max(1, parseInt(amt.value) || 1);
            val.value = Math.max(0, (parseInt(val.value) || 0) + Number(b.dataset.s) * passo); mark();
        }));
        val.addEventListener('input', mark);
    });

    ov.querySelector('#giacFiltro').addEventListener('input', function() {
        const q = this.value.toLowerCase();
        listEl.querySelectorAll('.giac-rowm').forEach(row => {
            row.style.display = row.querySelector('.giac-rowm-info').textContent.toLowerCase().includes(q) ? '' : 'none';
        });
    });

    const chiudi = () => ov.remove();
    ov.querySelector('.modal-close').addEventListener('click', chiudi);
    ov.querySelector('.modal-btn-cancel').addEventListener('click', chiudi);
    ov.addEventListener('click', e => { if (e.target === ov) chiudi(); });

    ov.querySelector('.modal-btn-save').addEventListener('click', async function() {
        const cambiate = [...listEl.querySelectorAll('.giac-rowm')].filter(row =>
            (parseInt(row.querySelector('.giac-rowm-val').value) || 0) !== Number(row.dataset.orig));
        if (!cambiate.length) { chiudi(); return; }
        this.disabled = true; this.textContent = 'Salvataggio...';
        for (const row of cambiate) {
            const v = Math.max(0, parseInt(row.querySelector('.giac-rowm-val').value) || 0);
            await apiFetch('/materiale/' + row.dataset.id, 'PUT', { quantita: v });
        }
        chiudi();
        caricaSezione('materie-prime');
    });

    setTimeout(() => { ov.querySelector('#giacFiltro').focus(); }, 50);
}

// ── ACCORDION CONTENT ─────────────────────────────────────────────────────────

async function caricaMacchineCommessa(idCommessa) {
    const tree = document.getElementById('tree-commessa-' + idCommessa);
    if (!tree) return;
    tree.innerHTML = '<p class="tree-empty">Caricamento...</p>';

    const res = await apiFetch('/commesse/' + idCommessa + '/macchine');
    if (!res) return;
    const macchine = await res.json();

    tree.innerHTML = '';
    const branch = document.createElement('div');
    branch.className = 'tree-branch';
    branch.appendChild(Object.assign(document.createElement('span'), { className: 'tree-line' }));

    if (!macchine.length) {
        branch.insertAdjacentHTML('beforeend', '<p class="tree-empty">Nessuna macchina associata.</p>');
    } else {
        macchine.forEach(m => {
            const item = document.createElement('div');
            item.className = 'tree-item';
            item.innerHTML =
                '<span class="tree-dot">&#9632;</span>' +
                '<button class="material-code machine-link-btn">' + esc(m.codice ?? '-') + '</button>' +
                '<span class="material-quantity">' + esc(m.descrizione ?? '') + '</span>' +
                '<span class="material-quantity badge ' + statoClass(m.stato) + '">' + esc(labelStatoMacchina(m.stato)) + '</span>' +
                '<span class="material-quantity">Qt. ' + (m.quantita ?? '-') + '</span>' +
                '<button class="action-btn delete-btn btn-rimuovi-mac" data-link-id="' + m.link_id + '" title="Rimuovi dalla commessa"><i class="fa-solid fa-trash"></i></button>';
            item.querySelector('.machine-link-btn').addEventListener('click', function(e) {
                e.stopPropagation();
                apriSchedaMacchina(m);
            });
            item.querySelector('.btn-rimuovi-mac').addEventListener('click', async function() {
                const r = await apiFetch('/commesse/' + idCommessa + '/macchine/' + this.dataset.linkId, 'DELETE');
                if (r && r.ok) caricaMacchineCommessa(idCommessa);
            });
            branch.appendChild(item);
        });
    }

    tree.appendChild(branch);

    // Form inline per associare una macchina dal catalogo
    const catalogo = await apiFetch('/macchine');
    const listaMac = (catalogo && catalogo.ok) ? await catalogo.json() : [];

    const addRow = document.createElement('div');
    addRow.className = 'tree-add-row';
    addRow.innerHTML =
        '<span class="mc-sel-mount" style="flex:1;min-width:0;"></span>' +
        '<input type="number" placeholder="Qtà" id="mc-qty-' + idCommessa + '" class="tree-input tree-input-sm" value="1" min="1" step="1">' +
        '<select id="mc-stato-' + idCommessa + '" class="tree-input">' +
            '<option value="DA_PRODURRE">Da produrre</option>' +
            '<option value="IN_MAGAZZINO">In magazzino</option>' +
        '</select>' +
        '<button class="bom-confirm-btn" id="mc-add-' + idCommessa + '" title="Aggiungi macchina"><i class="fa-solid fa-plus"></i></button>';
    const macCombo = creaAutocomplete(
        listaMac.map(m => ({ value: String(m.id), codice: m.codice ?? '-', desc: m.descrizione ?? '',
                             label: (m.codice ?? '-') + ' — ' + (m.descrizione ?? '') })),
        'Cerca macchina per codice o descrizione...',
        { id: 'mc-sel-' + idCommessa, wide: true });
    addRow.querySelector('.mc-sel-mount').appendChild(macCombo);
    tree.appendChild(addRow);

    document.getElementById('mc-add-' + idCommessa).addEventListener('click', async function() {
        const sel = document.getElementById('mc-sel-' + idCommessa);
        const idMac = sel?.value;
        if (!idMac) { macCombo.querySelector('.ac-input')?.focus(); return; }
        const qty   = parseInt(document.getElementById('mc-qty-' + idCommessa).value) || 1;
        const stato = document.getElementById('mc-stato-' + idCommessa).value;
        this.disabled = true;
        const r = await apiFetch('/commesse/' + idCommessa + '/macchine', 'POST',
            { id_macchina: Number(idMac), quantita: qty, stato });
        this.disabled = false;
        if (r && (r.ok || r.status === 201)) {
            caricaMacchineCommessa(idCommessa);
        } else if (r) {
            const err = await r.json().catch(() => ({}));
            alert('Errore: ' + (err.errore || r.status));
        }
    });

    aggiornaAltezzaPanel(tree);
}

// Costruisce l'albero tipato (materiali/processi/semilavorati) di una macchina come elemento DOM
function costruisciAlberoTipi(alb) {
    const cont = document.createElement('div');
    cont.className = 'albero-macchina';

    function rigaMateriale(rm, depth) {
        const row = document.createElement('div');
        row.className = 'albero-row tipo-materiale';
        row.style.marginLeft = (depth * 22) + 'px';
        row.innerHTML =
            '<span class="albero-chip chip-materiale"><i class="fa-solid fa-cube"></i> Materiale</span>' +
            '<span class="albero-nome">' + esc(rm.codice ?? '-') + '</span>' +
            '<span class="albero-desc">' + esc(rm.descrizione ?? '') + '</span>' +
            '<span class="albero-qty">×' + (rm.quantita_richiesta ?? 1) + '</span>';
        cont.appendChild(row);
    }
    function rigaLavorazione(lav, depth) {
        const isSem = !!lav.semilavorato;
        const row = document.createElement('div');
        row.className = 'albero-row ' + (isSem ? 'tipo-semilav' : 'tipo-processo');
        row.style.marginLeft = (depth * 22) + 'px';
        row.innerHTML =
            (isSem
                ? '<span class="albero-chip chip-semilav"><i class="fa-solid fa-cubes-stacked"></i> Semilavorato</span>'
                : '<span class="albero-chip chip-processo"><i class="fa-solid fa-screwdriver-wrench"></i> Processo</span>') +
            '<span class="albero-nome">' + esc(lav.descrizione ?? '-') + '</span>';
        cont.appendChild(row);
        (lav.rich_mat || []).forEach(rm => rigaMateriale(rm, depth + 1));
        (lav.figli || []).forEach(f => rigaLavorazione(f, depth + 1));
    }

    (alb.lavorazioni || []).forEach(l => rigaLavorazione(l, 0));

    if (alb.materiali_diretti && alb.materiali_diretti.length) {
        const sep = document.createElement('div');
        sep.className = 'albero-sep';
        sep.textContent = 'Materiali diretti della macchina';
        cont.appendChild(sep);
        alb.materiali_diretti.forEach(rm => rigaMateriale(rm, 0));
    }
    return cont;
}

async function caricaLavorazioniMacchina(idMacchina) {
    const tree = document.getElementById('tree-macchina-' + idMacchina);
    if (!tree) return;
    tree.innerHTML = '<p class="tree-empty">Caricamento...</p>';

    const res = await apiFetch('/macchine/' + idMacchina + '/albero');
    if (!res || !res.ok) { tree.innerHTML = '<p class="tree-empty">Errore nel caricamento.</p>'; aggiornaAltezzaPanel(tree); return; }
    const alb = await res.json();

    const haProc = alb.lavorazioni && alb.lavorazioni.length;
    const haDir  = alb.materiali_diretti && alb.materiali_diretti.length;
    if (!haProc && !haDir) {
        tree.innerHTML = '<p class="tree-empty">Nessun elemento. Apri la scheda macchina per aggiungere processi e materiali.</p>';
        aggiornaAltezzaPanel(tree);
        return;
    }

    tree.innerHTML = '';
    tree.appendChild(costruisciAlberoTipi(alb));
    aggiornaAltezzaPanel(tree);
}

// Storico lavorazioni di una macchina (modale di sola lettura) — usato dalle macchine collassate
async function apriStoricoMacchina(idMacchina, codice) {
    const res = await apiFetch('/macchine/' + idMacchina + '/albero');
    if (!res || !res.ok) { alert('Errore nel caricamento dello storico.'); return; }
    const alb = await res.json();

    const ov = document.createElement('div');
    ov.className = 'modal-overlay open';
    ov.innerHTML =
        '<div class="modal modal-storico"><div class="modal-header">' +
        '<h3><i class="fa-solid fa-clock-rotate-left"></i> Storico lavorazioni — ' + esc(codice ?? '') + '</h3>' +
        '<button class="modal-close"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="modal-body" id="storicoBody"></div>' +
        '<div class="modal-footer"><button class="modal-btn-cancel">Chiudi</button></div></div>';
    document.body.appendChild(ov);
    ov.querySelector('#storicoBody').appendChild(costruisciAlberoTipi(alb));

    const chiudi = () => ov.remove();
    ov.querySelector('.modal-close').addEventListener('click', chiudi);
    ov.querySelector('.modal-btn-cancel').addEventListener('click', chiudi);
    ov.addEventListener('click', e => { if (e.target === ov) chiudi(); });
}

// ── MODAL ─────────────────────────────────────────────────────────────────────

const campiPerSezione = {
    'commesse': [
        { key: 'codice_commessa', label: 'Codice Commessa', type: 'text',   valoreKey: 'codice' },
        { key: 'id_cliente',      label: 'ID Cliente',      type: 'number', min: '0', valoreKey: 'id_cliente' },
        { key: 'descrizione',     label: 'Descrizione',     type: 'text',   valoreKey: 'descrizione' },
        { key: 'anno',            label: 'Anno',            type: 'number', min: '1900', valoreKey: 'anno' },
        { key: 'data_consegna',   label: 'Data Consegna',   type: 'date',   valoreKey: 'data_consegna' },
        { key: 'stato_chiusura',  label: 'Stato',           type: 'select', options: ['APERTA','CHIUSA'], valoreKey: 'stato' }
    ],
    'macchine': [
        { key: 'codice',      label: 'Codice Macchina', type: 'text', valoreKey: 'codice' },
        { key: 'descrizione', label: 'Descrizione',     type: 'text', valoreKey: 'descrizione' }
    ],
    'lavorazioni': [
        { key: 'descrizione', label: 'Nome processo', type: 'text', valoreKey: 'descrizione' }
    ],
    'semilavorati': [
        { key: 'codice',      label: 'Codice',      type: 'text', valoreKey: 'codice' },
        { key: 'descrizione', label: 'Descrizione', type: 'text', valoreKey: 'descrizione' }
    ],
    'materie-prime': [
        { key: 'codice',      label: 'Codice Materiale', type: 'text',   valoreKey: 'codice' },
        { key: 'descrizione', label: 'Descrizione',      type: 'text',   valoreKey: 'descrizione' },
        { key: 'quantita',    label: 'Quantità in stock',type: 'number', min: '0', valoreKey: 'quantita' }
    ]
};

let modalMode = 'add';
let modalId   = null;

function apriModale(sezione, datiEsistenti = null) {
    const campi = campiPerSezione[sezione];
    const body  = document.getElementById('modalBody');
    document.getElementById('modalTitle').textContent = datiEsistenti ? 'Modifica' : 'Aggiungi';
    modalMode = datiEsistenti ? 'edit' : 'add';
    modalId   = datiEsistenti?.id ?? null;

    body.innerHTML = campi.map(campo => {
        const valore = datiEsistenti ? (datiEsistenti[campo.valoreKey] ?? '') : '';
        if (campo.type === 'select') {
            const opts = campo.options.map(o =>
                '<option value="' + o + '"' + (valore === o ? ' selected' : '') + '>' + o + '</option>'
            ).join('');
            return '<div class="modal-field"><label>' + campo.label + '</label><select id="field_' + campo.key + '">' + opts + '</select></div>';
        }
        return '<div class="modal-field"><label>' + campo.label + (campo.optional ? ' <span style="color:#aaa;font-weight:400">(opzionale)</span>' : '') + '</label>' +
               '<input type="' + campo.type + '" id="field_' + campo.key + '" value="' + esc(valore ?? '') + '" placeholder="' + campo.label + '"' +
               (campo.min !== undefined ? ' min="' + campo.min + '"' : '') + '></div>';
    }).join('');

    document.getElementById('modalOverlay').classList.add('open');
}

function chiudiModale() {
    document.getElementById('modalOverlay').classList.remove('open');
    modalId = null;
}

document.getElementById('modalClose').addEventListener('click', chiudiModale);
document.getElementById('modalCancel').addEventListener('click', chiudiModale);
document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modalOverlay')) chiudiModale();
});
document.getElementById('addBtn').addEventListener('click', () => apriModale(sezioneCorrente));

document.getElementById('modalSave').addEventListener('click', async () => {
    const campi = campiPerSezione[sezioneCorrente];
    const body = {};
    let errore = null;

    campi.forEach(campo => {
        const el = document.getElementById('field_' + campo.key);
        if (!el) return;
        const val = el.value;
        if (!campo.optional && campo.type === 'number' && campo.min !== undefined) {
            if (val !== '' && Number(val) < Number(campo.min)) {
                if (!errore) errore = '"' + campo.label + '" deve essere ≥ ' + campo.min;
            }
        }
        // tav_padre vuoto = null
        if (campo.optional && campo.type === 'number' && val === '') {
            body[campo.key] = null;
        } else {
            body[campo.key] = campo.type === 'number' ? (val === '' ? null : Number(val)) : val;
        }
    });

    if (errore) { alert(errore); return; }

    const endpointMap = { 'commesse': '/commesse', 'macchine': '/macchine', 'lavorazioni': '/processi', 'semilavorati': '/semilavorati', 'materie-prime': '/materiale' };
    const endpoint = endpointMap[sezioneCorrente];

    const res = modalMode === 'add'
        ? await apiFetch(endpoint, 'POST', body)
        : await apiFetch(endpoint + '/' + modalId, 'PUT', body);

    if (res && (res.ok || res.status === 201)) {
        chiudiModale();
        caricaSezione(sezioneCorrente);
    } else if (res) {
        const err = await res.json().catch(() => ({}));
        alert('Errore: ' + (err.errore || 'salvataggio fallito'));
    }
});

// ── ELIMINA ───────────────────────────────────────────────────────────────────

function attaccaEventiCard() {
    document.querySelectorAll('.btn-modifica').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const card = this.closest('[data-record]');
            const record = JSON.parse(card.dataset.record);
            sezioneCorrente = card.dataset.sezione;
            apriModale(sezioneCorrente, record);
        });
    });

    document.querySelectorAll('.btn-elimina').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const card = this.closest('[data-record]');
            const id = card.dataset.id;
            const sezione = card.dataset.sezione;
            const label = card.querySelector('.item-code')?.textContent ?? '#' + id;
            eliminaElemento(sezione, label, id);
        });
    });
}

async function eliminaElemento(sezione, label, id) {
    if (!confirm('Eliminare "' + label + '"?')) return;
    if (!id) { alert('ID non disponibile.'); return; }
    const endpointMap = { 'commesse': '/commesse', 'macchine': '/macchine', 'lavorazioni': '/processi', 'semilavorati': '/semilavorati', 'materie-prime': '/materiale' };
    const res = await apiFetch(endpointMap[sezione] + '/' + id, 'DELETE');
    if (res && res.ok) caricaSezione(sezioneCorrente);
    else alert('Errore nell\'eliminazione.');
}

// ── SCHEDA MACCHINA (overlay con grafo lavorazioni) ───────────────────────────

let _blobUrls     = [];
let _visNetwork   = null;
let _currentMacchina = null;

function apriSchedaMacchina(m) {
    _currentMacchina = { id: m.id, codice: m.codice };

    document.getElementById('machinePanelTitle').textContent  = m.codice ?? 'Scheda Macchina';
    document.getElementById('machineInfoCode').textContent    = m.codice ?? '-';
    document.getElementById('machineInfoDesc').textContent    = m.descrizione ?? '-';

    const photo = document.getElementById('machinePhoto');
    photo.src = '';
    photo.style.display = 'none';
    document.getElementById('machineNoPhoto').style.display = '';
    document.getElementById('machineStList').innerHTML    = '<p class="machine-no-file">Caricamento...</p>';
    document.getElementById('machineStPreview').innerHTML = '<p class="machine-no-file">Seleziona una scheda tecnica per visualizzarla.</p>';
    document.getElementById('machineBomGraph').innerHTML  = '<p class="machine-no-file">Caricamento grafo...</p>';

    document.getElementById('machineOverlay').classList.add('open');
    caricaFilesMacchina(m.id, m.codice);
    caricaGrafoLavorazioni(m.id, m.codice);
}

async function caricaFilesMacchina(idMacchina, codice) {
    _blobUrls.forEach(u => URL.revokeObjectURL(u));
    _blobUrls = [];

    const res = await apiFetch('/macchine/' + idMacchina + '/files');
    if (!res) return;
    const files = await res.json();

    if (files.immagine) {
        const imgRes = await apiFetch('/macchine/img/' + encodeURIComponent(files.immagine));
        if (imgRes && imgRes.ok) {
            const blob = await imgRes.blob();
            const url  = URL.createObjectURL(blob);
            _blobUrls.push(url);
            const photo = document.getElementById('machinePhoto');
            photo.src = url;
            photo.style.display = '';
            document.getElementById('machineNoPhoto').style.display = 'none';
        }
    }

    const listEl = document.getElementById('machineStList');
    if (!files.schede || !files.schede.length) {
        listEl.innerHTML = '<p class="machine-no-file">Nessuna scheda tecnica disponibile.</p>';
        return;
    }
    listEl.innerHTML = '';
    files.schede.forEach(filename => {
        const label = filename.replace(/\.pdf$/i, '').replace(new RegExp('^' + codice + '[_-]?'), '') || filename;
        const btn = document.createElement('button');
        btn.className = 'st-item-btn';
        btn.dataset.filename = filename;
        btn.innerHTML = '<i class="fa-regular fa-file-pdf"></i> ' + label;
        btn.addEventListener('click', async function() {
            listEl.querySelectorAll('.st-item-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            await mostraPDF(filename);
        });
        listEl.appendChild(btn);
    });
    listEl.querySelector('.st-item-btn').click();
}

async function mostraPDF(filename) {
    const preview = document.getElementById('machineStPreview');
    preview.innerHTML = '<p class="machine-no-file">Caricamento PDF...</p>';
    const res = await apiFetch('/macchine/st/' + encodeURIComponent(filename));
    if (!res || !res.ok) { preview.innerHTML = '<p class="machine-no-file">Errore nel caricamento del PDF.</p>'; return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    _blobUrls.push(url);
    preview.innerHTML = '<embed src="' + url + '" type="application/pdf" style="width:100%;height:100%;border:none;border-radius:8px;">';
}

// ── GRAFO LAVORAZIONI (vis.js) ────────────────────────────────────────────────

async function caricaGrafoLavorazioni(idMacchina, codice) {
    const container = document.getElementById('machineBomGraph');

    if (typeof vis === 'undefined') {
        container.innerHTML = '<p class="machine-no-file"><i class="fa-solid fa-triangle-exclamation"></i><br>Libreria grafo non disponibile.</p>';
        return;
    }

    const res = await apiFetch('/macchine/' + idMacchina + '/albero');
    if (!res || !res.ok) { container.innerHTML = '<p class="machine-no-file">Errore caricamento albero.</p>'; return; }
    const tree = await res.json();

    const haContenuto = (tree.lavorazioni && tree.lavorazioni.length) ||
                        (tree.materiali_diretti && tree.materiali_diretti.length);
    if (!haContenuto) {
        container.innerHTML = '<p class="machine-no-file"><i class="fa-solid fa-diagram-project" style="opacity:.3"></i><br>Nessun elemento. Usa "+ Processo" per iniziare.</p>';
        return;
    }

    try {
        container.innerHTML = '';
        if (_visNetwork) { _visNetwork.destroy(); _visNetwork = null; }

        const NODE_X_SEP = 200;
        const NODE_Y_SEP = 85;
        let _nextY = 0;
        let _maxY  = 0;

        function getChildren(item) {
            if (item.tipo === 'macchina')    return [...(item.lavorazioni || []), ...(item.materiali_diretti || [])];
            if (item.tipo === 'lavorazione') return [...(item.figli || []), ...(item.rich_mat || [])];
            return [];
        }

        function processNode(item, level) {
            item._px = level * NODE_X_SEP;
            const children = getChildren(item);
            if (!children.length) {
                item._py = _nextY; _maxY = Math.max(_maxY, _nextY); _nextY += NODE_Y_SEP;
                return;
            }
            const firstY = _nextY;
            children.forEach(c => processNode(c, level + 1));
            item._py = (firstY + _nextY - NODE_Y_SEP) / 2;
            _maxY = Math.max(_maxY, item._py);
        }
        processNode(tree, 0);

        container.style.height = Math.min(Math.max(_maxY + NODE_Y_SEP + 20, 220), 520) + 'px';

        const nodes = [], edges = [];
        let nc = 0;
        _bomNodeMeta = {};   // visId → { tipo, dbId, descrizione }

        function addNodo(item, parentId) {
            const id = ++nc;
            let bg, border, fc, bw, label;

            if (item.tipo === 'macchina') {
                bg = '#1c1c1c'; border = '#e5006d'; fc = '#ffffff'; bw = 2;
                label = (item.codice ?? '') + '\n' + (item.descrizione ?? '').substring(0, 24);
                _bomNodeMeta[id] = { tipo: 'macchina', dbId: item.id };
            } else if (item.tipo === 'lavorazione') {
                // Catalogo: struttura senza stato (lo stato è per commessa)
                bg = '#eef1f6'; border = '#5e6b85'; fc = '#2b3550'; bw = 2;
                label = (item.descrizione ?? '').substring(0, 30);
                _bomNodeMeta[id] = { tipo: 'lavorazione', dbId: item.id, descrizione: item.descrizione };
            } else { // rich_mat
                bg = '#fff8e1'; border = '#ffb300'; fc = '#5d4037'; bw = 1;
                label = (item.codice ?? '-') + '\nx' + (item.quantita_richiesta ?? 1);
                _bomNodeMeta[id] = { tipo: 'rich_mat', dbId: item.id };
            }

            nodes.push({
                id, label, shape: 'box',
                x: item._px, y: item._py,
                color: { background: bg, border },
                font: { color: fc, size: 11, face: 'Poppins, sans-serif' },
                margin: { top: 7, bottom: 7, left: 11, right: 11 },
                borderWidth: bw
            });
            if (parentId !== null) edges.push({ from: parentId, to: id, arrows: 'to', color: { color: '#bbb' } });
            getChildren(item).forEach(c => addNodo(c, id));
            return id;
        }
        addNodo(tree, null);

        _visNetwork = new vis.Network(
            container,
            { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) },
            {
                layout:      { hierarchical: false },
                physics:     { enabled: false },
                edges:       { smooth: { type: 'cubicBezier', forceDirection: 'horizontal' } },
                interaction: { hover: true, dragNodes: true, dragView: true, zoomView: true, navigationButtons: true, keyboard: false }
            }
        );
        // Click su un nodo → menu di modifica struttura (catalogo editabile dal grafo)
        _visNetwork.on('click', params => {
            chiudiBomEditMenu();
            if (!params.nodes.length) return;
            const meta = _bomNodeMeta[params.nodes[0]];
            if (meta) mostraBomEditMenu(meta, params.pointer.DOM);
        });
        setTimeout(() => { if (_visNetwork) { _visNetwork.redraw(); _visNetwork.fit(); } }, 300);

    } catch (err) {
        container.innerHTML = '<p class="machine-no-file">Errore grafo: ' + err.message + '</p>';
    }
}

// ── EDITING STRUTTURA CATALOGO (dal grafo) ────────────────────────────────────

let _bomNodeMeta = {};

function ricaricaGrafoCorrente() {
    if (_currentMacchina) caricaGrafoLavorazioni(_currentMacchina.id, _currentMacchina.codice);
}

function chiudiBomEditMenu() {
    const ex = document.getElementById('bomEditPanel');
    if (ex) ex.remove();
}

function mostraBomEditMenu(meta, domPos) {
    const graph = document.getElementById('machineBomGraph');
    const panel = document.createElement('div');
    panel.id = 'bomEditPanel';
    panel.className = 'bom-edit-panel';

    let html = '';
    if (meta.tipo === 'macchina') {
        html =
            '<button data-act="add-proc"><i class="fa-solid fa-plus"></i> Processo</button>' +
            '<button data-act="add-mat-dir"><i class="fa-solid fa-cube"></i> Materiale diretto</button>';
    } else if (meta.tipo === 'lavorazione') {
        html =
            '<button data-act="add-sub"><i class="fa-solid fa-plus"></i> Sotto-processo</button>' +
            '<button data-act="add-mat"><i class="fa-solid fa-cube"></i> Materiale</button>' +
            '<button data-act="del-lav" class="danger"><i class="fa-solid fa-trash"></i> Elimina</button>';
    } else { // rich_mat
        html = '<button data-act="del-mat" class="danger"><i class="fa-solid fa-trash"></i> Rimuovi materiale</button>';
    }
    panel.innerHTML = html;

    graph.appendChild(panel);
    // posiziona vicino al click, dentro il container
    const maxX = graph.clientWidth - panel.offsetWidth - 8;
    const maxY = graph.clientHeight - panel.offsetHeight - 8;
    panel.style.left = Math.max(8, Math.min(domPos.x, maxX)) + 'px';
    panel.style.top  = Math.max(8, Math.min(domPos.y, maxY)) + 'px';

    panel.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => gestisciAzioneBom(b.dataset.act, meta));
    });
}

function gestisciAzioneBom(act, meta) {
    chiudiBomEditMenu();
    const idMac = _currentMacchina?.id;
    if (!idMac) return;

    if (act === 'add-proc')         apriModaleElemento(idMac, { tipo: 'processo' });
    else if (act === 'add-sub')     apriModaleElemento(idMac, { tipo: 'processo', parent: meta.dbId });
    else if (act === 'add-mat')     apriModaleElemento(idMac, { tipo: 'materia', posizione: 'sotto', targetLav: meta.dbId });
    else if (act === 'add-mat-dir') apriModaleElemento(idMac, { tipo: 'materia', posizione: 'diretto' });
    else if (act === 'del-lav')     eliminaProcessoBom(meta);
    else if (act === 'del-mat')     eliminaMaterialeBom(meta);
}

// Modale unica: aggiunge un PROCESSO (dal catalogo) o una MATERIA PRIMA (sotto un processo o diretta)
async function apriModaleElemento(idMac, opts = {}) {
    const [pr, ma, lv, sl] = await Promise.all([
        apiFetch('/processi'), apiFetch('/materiale'), apiFetch('/macchine/' + idMac + '/lavorazioni'), apiFetch('/semilavorati')
    ]);
    const processi  = (pr && pr.ok) ? await pr.json() : [];
    const materiali = (ma && ma.ok) ? await ma.json() : [];
    const lavs      = (lv && lv.ok) ? await lv.json() : [];
    const semilav   = (sl && sl.ok) ? await sl.json() : [];

    const ov = document.createElement('div');
    ov.className = 'modal-overlay open';
    ov.innerHTML =
        '<div class="modal"><div class="modal-header"><h3>Aggiungi elemento</h3>' +
        '<button class="modal-close"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="modal-body">' +
            '<div class="modal-field"><label>Tipo</label><select id="el_tipo">' +
                '<option value="processo">Processo</option>' +
                '<option value="materia">Materia prima</option>' +
                '<option value="semilavorato">Semilavorato</option></select></div>' +
            '<div class="modal-field el-proc"><label>Processo (dal catalogo Lavorazioni)</label>' +
                '<div class="el-proc-mount"></div></div>' +
            '<div class="modal-field el-proc"><label>Processo precedente</label>' +
                '<div class="el-prec-mount"></div></div>' +
            '<div class="modal-field el-mat"><label>Materia prima</label><div class="el-mat-mount"></div></div>' +
            '<div class="modal-field el-sem"><label>Semilavorato</label><div class="el-sem-mount"></div></div>' +
            '<div class="modal-field el-comp"><label>Quantità</label>' +
                '<input type="number" id="el_qty" value="1" min="0.01" step="0.01"></div>' +
            '<div class="modal-field el-comp"><label>Posizione</label>' +
                '<select id="el_pos"><option value="diretto">Diretta sulla macchina</option><option value="sotto">Sotto un processo</option></select></div>' +
            '<div class="modal-field el-comp el-sotto"><label>Processo</label>' +
                '<div class="el-lav-mount"></div></div>' +
        '</div>' +
        '<div class="modal-footer"><button class="modal-btn-cancel">Annulla</button>' +
        '<button class="modal-btn-save">Salva</button></div></div>';
    document.body.appendChild(ov);

    const $  = s => ov.querySelector(s);
    const hide = (sel, h) => ov.querySelectorAll(sel).forEach(e => e.style.display = h ? 'none' : '');

    // barre di ricerca (combobox) al posto dei menu a tendina pieni di voci
    const lavOpzioni = lavs.map(l => ({ value: String(l.id), label: l.descrizione ?? ('#' + l.id) }));
    const procCombo = creaAutocomplete(processi.map(p => ({ value: String(p.id), label: p.descrizione ?? '-' })),
        'Cerca processo...', { id: 'el_proc', wide: true });
    const precCombo = creaAutocomplete(lavOpzioni, '— Nessuno (iniziale) —', { id: 'el_prec', wide: true });
    const lavCombo  = creaAutocomplete(lavOpzioni, 'Cerca processo...', { id: 'el_lav', wide: true });
    const matCombo = creaAutocomplete(materiali.map(m => ({ value: String(m.id), codice: m.codice ?? '-', desc: m.descrizione ?? '', label: (m.codice ?? '-') + ' — ' + (m.descrizione ?? '') })), 'Cerca materia prima per codice o descrizione...');
    const semCombo = creaAutocomplete(semilav.map(s => ({ value: String(s.id), codice: s.codice || '', desc: s.descrizione || '', label: (s.codice ? s.codice + ' — ' : '') + (s.descrizione || s.codice || '-') })), 'Cerca semilavorato...');
    $('.el-proc-mount').appendChild(procCombo);
    $('.el-prec-mount').appendChild(precCombo);
    $('.el-lav-mount').appendChild(lavCombo);
    $('.el-mat-mount').appendChild(matCombo);
    $('.el-sem-mount').appendChild(semCombo);
    function aggiorna() {
        const tipo = $('#el_tipo').value;
        hide('.el-proc', tipo !== 'processo');
        hide('.el-mat',  tipo !== 'materia');
        hide('.el-sem',  tipo !== 'semilavorato');
        hide('.el-comp', tipo === 'processo');                       // quantità/posizione per materia e semilavorato
        if (tipo !== 'processo') hide('.el-sotto', $('#el_pos').value !== 'sotto');
    }
    $('#el_tipo').addEventListener('change', aggiorna);
    $('#el_pos').addEventListener('change', aggiorna);

    if (opts.tipo)      $('#el_tipo').value = opts.tipo;
    if (opts.parent)    precCombo.setValore(opts.parent);
    if (opts.posizione) $('#el_pos').value  = opts.posizione;
    if (opts.targetLav) lavCombo.setValore(opts.targetLav);
    aggiorna();

    const chiudi = () => ov.remove();
    $('.modal-close').addEventListener('click', chiudi);
    $('.modal-btn-cancel').addEventListener('click', chiudi);
    ov.addEventListener('click', e => { if (e.target === ov) chiudi(); });

    $('.modal-btn-save').addEventListener('click', async () => {
        const tipo = $('#el_tipo').value;
        let r;
        if (tipo === 'processo') {
            const idProc = $('#el_proc').value;
            if (!idProc) { alert('Seleziona un processo dal catalogo.'); return; }
            const body = { id_macchina: idMac, id_processo: Number(idProc) };
            const prec = $('#el_prec').value;
            if (prec) body.tav_padre = Number(prec);
            r = await apiFetch('/lavorazioni', 'POST', body);
        } else {
            // materia prima o semilavorato: stessa scelta di posizione
            const qty = parseFloat($('#el_qty').value) || 1;
            const sotto = ($('#el_pos').value === 'sotto');
            let idLav = null;
            if (sotto) {
                idLav = $('#el_lav').value;
                if (!idLav) { alert('Seleziona il processo sotto cui inserire.'); return; }
            }
            if (tipo === 'materia') {
                const selMat = matCombo.getValore();
                if (!selMat) { alert('Cerca e seleziona una materia prima.'); return; }
                const payload = { id_materiale: Number(selMat.value), quantita: qty };
                r = sotto ? await apiFetch('/lavorazioni/' + idLav + '/rich_mat', 'POST', payload)
                          : await apiFetch('/macchine/' + idMac + '/rich_mat', 'POST', payload);
            } else { // semilavorato
                const selSem = semCombo.getValore();
                if (!selSem) { alert('Cerca e seleziona un semilavorato.'); return; }
                const payload = { id_semilavorato: Number(selSem.value), quantita: qty };
                r = sotto ? await apiFetch('/lavorazioni/' + idLav + '/semilavorato', 'POST', payload)
                          : await apiFetch('/macchine/' + idMac + '/semilavorato', 'POST', payload);
            }
        }
        if (r && (r.ok || r.status === 201)) { chiudi(); ricaricaGrafoCorrente(); }
        else if (r) { const e = await r.json().catch(() => ({})); alert('Errore: ' + (e.errore || r.status)); }
    });

    const first = ov.querySelector('select');
    if (first) first.focus();
}

async function eliminaProcessoBom(meta) {
    if (!confirm('Eliminare il processo "' + (meta.descrizione ?? '') + '" e i suoi materiali?')) return;
    const r = await apiFetch('/lavorazioni/' + meta.dbId, 'DELETE');
    if (r && r.ok) ricaricaGrafoCorrente();
}

async function eliminaMaterialeBom(meta) {
    if (!confirm('Rimuovere questo materiale dal processo?')) return;
    const r = await apiFetch('/rich_mat/' + meta.dbId, 'DELETE');
    if (r && r.ok) ricaricaGrafoCorrente();
}

document.getElementById('bomAddRootBtn').addEventListener('click', function() {
    if (!_currentMacchina) return;
    apriModaleElemento(_currentMacchina.id, { tipo: 'processo' });
});

function chiudiSchedaMacchina() {
    if (document.fullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    document.getElementById('machineOverlay').classList.remove('open');
    chiudiBomEditMenu();
    _currentMacchina = null;
    _blobUrls.forEach(u => URL.revokeObjectURL(u));
    _blobUrls = [];
    if (_visNetwork) { _visNetwork.destroy(); _visNetwork = null; }
}

document.getElementById('machinePanelClose').addEventListener('click', chiudiSchedaMacchina);
document.getElementById('machineOverlay').addEventListener('click', function(e) {
    if (e.target === this) chiudiSchedaMacchina();
});

document.getElementById('bomFullscreenBtn').addEventListener('click', function() {
    const section = document.getElementById('bomSection');
    if (!document.fullscreenElement) (section.requestFullscreen || section.webkitRequestFullscreen).call(section);
    else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
});
document.addEventListener('fullscreenchange', _onBomFullscreenChange);
document.addEventListener('webkitfullscreenchange', _onBomFullscreenChange);
function _onBomFullscreenChange() {
    const btn  = document.getElementById('bomFullscreenBtn');
    const icon = btn ? btn.querySelector('i') : null;
    const isFS = !!document.fullscreenElement;
    if (icon) icon.className = isFS ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
    if (btn)  btn.title      = isFS ? 'Esci da schermo intero' : 'Schermo intero';
    if (_visNetwork) setTimeout(() => { _visNetwork.redraw(); _visNetwork.fit(); }, 80);
}

// ── VISTA OPERATIVA COMMESSA (drag&drop materiali → processi) ─────────────────

let _commessaCorrente = null;
let _visCommessa = null;
let _comNodeMeta = {};

// Collasso macchina = persistente nel DB (campo collassata su commessa_macchine)
async function collassaMacchina(cmId, val) {
    const r = await apiFetch('/commessa-macchine/' + cmId + '/collassa', 'POST', { collassata: !!val });
    if (r && r.ok && _commessaCorrente) caricaAlberoCommessa(_commessaCorrente);
}

// Conferma manuale dell'avanzamento (materiale o processo) = persistente nel DB. Poi ricarica il grafo.
async function confermaAvanzamento(cmId, tipo, refId) {
    await apiFetch('/commessa-macchine/' + cmId + '/conferma/' + tipo + '/' + refId, 'POST');
    if (_commessaCorrente) caricaAlberoCommessa(_commessaCorrente);
}
// Annulla una conferma (se si è sbagliato). I materiali in scaffalatura restano invariati.
async function annullaAvanzamento(cmId, tipo, refId) {
    await apiFetch('/commessa-macchine/' + cmId + '/conferma/' + tipo + '/' + refId, 'DELETE');
    if (_commessaCorrente) caricaAlberoCommessa(_commessaCorrente);
}

// ── AVANZAMENTO MANUALE: un elemento "conta" solo dopo che l'utente lo trascina sul padre ──
// Un materiale è completo in scaffalatura quando le unità preparate raggiungono il target.
function rmCompleto(r) { return r.quantita_fornita >= r.target; }
// "Pronto da confermare": completo ma non ancora trascinato sul padre.
function rmPronto(r)   { return rmCompleto(r) && !r.confermato; }

// Una lavorazione è CONFERMABILE (trascinabile sul padre) quando TUTTI i suoi materiali e
// TUTTE le sue sottolavorazioni sono già confermati — e non è bloccata né già confermata.
function lavConfermabile(lav) {
    if (lav.bloccato || lav.confermato) return false;
    const matOk = (lav.rich_mat || []).every(r => r.confermato);
    const figOk = (lav.figli || []).every(f => f.confermato);
    return matOk && figOk;
}
// In corso = qualcosa è già stato preparato/confermato, ma non è ancora tutto confermato.
function lavInCorso(lav) {
    return (lav.rich_mat || []).some(r => r.confermato || r.quantita_fornita > 0)
        || (lav.figli || []).some(f => f.confermato || lavInCorso(f));
}
// Una macchina è completa (trascinabile sulla commessa) quando tutti i processi e i
// materiali diretti sono CONFERMATI.
function macchinaCompleta(m) {
    const procOk = (m.lavorazioni || []).every(l => l.confermato);
    const dirOk  = (m.materiali_diretti || []).every(d => d.confermato);
    const haQualcosa = (m.lavorazioni || []).length || (m.materiali_diretti || []).length;
    return haQualcosa && procOk && dirOk;
}
// Progresso commessa = target dei materiali CONFERMATI / target totale (solo confermati contano).
function calcolaProgresso(albero) {
    let forn = 0, tot = 0;
    const cont = r => { tot += r.target; if (r.confermato) forn += r.target; };
    const visitaLav = lav => { (lav.rich_mat || []).forEach(cont); (lav.figli || []).forEach(visitaLav); };
    (albero.macchine || []).forEach(m => {
        (m.lavorazioni || []).forEach(visitaLav);
        (m.materiali_diretti || []).forEach(cont);
    });
    return tot > 0 ? Math.round(100 * forn / tot) : 0;
}

function apriVistaCommessa(c) {
    _commessaCorrente = c.id;
    document.getElementById('commessaPanelTitle').textContent =
        'Commessa ' + (c.codice ?? '#' + c.id) + (c.descrizione ? ' — ' + c.descrizione : '');
    const fill0 = document.getElementById('commessaProgressFill');
    const lab0 = document.getElementById('commessaProgressLabel');
    if (fill0) { fill0.style.width = '0%'; fill0.classList.remove('cpb-done'); }
    if (lab0) lab0.textContent = '0%';
    document.getElementById('commessaOpBody').innerHTML = '<p class="machine-no-file">Caricamento...</p>';
    document.getElementById('commessaOverlay').classList.add('open');
    caricaAlberoCommessa(c.id);
}

function chiudiVistaCommessa() {
    document.getElementById('commessaOverlay').classList.remove('open');
    chiudiComMenu();
    if (_visCommessa) { _visCommessa.destroy(); _visCommessa = null; }
    _commessaCorrente = null;
}

async function caricaAlberoCommessa(idCommessa) {
    const body = document.getElementById('commessaOpBody');
    if (typeof vis === 'undefined') {
        body.innerHTML = '<p class="machine-no-file">Libreria grafo non disponibile.</p>';
        return;
    }
    const res = await apiFetch('/commesse/' + idCommessa + '/albero');
    if (!res || !res.ok) { body.innerHTML = '<p class="machine-no-file">Errore nel caricamento.</p>'; return; }
    const albero = await res.json();
    if (!albero.macchine || !albero.macchine.length) {
        body.innerHTML = '<p class="machine-no-file"><i class="fa-solid fa-diagram-project" style="opacity:.3"></i><br>Nessuna macchina associata alla commessa.</p>';
        return;
    }

    chiudiComMenu();
    body.innerHTML = '';
    const container = document.createElement('div');
    container.id = 'commessaBomGraph';
    container.className = 'commessa-bom-graph';
    body.appendChild(container);

    if (_visCommessa) { _visCommessa.destroy(); _visCommessa = null; }
    _comNodeMeta = {};

    const tree = { tipo: 'commessa', id: albero.id, codice: albero.codice, descrizione: albero.descrizione, macchine: albero.macchine };

    // Barra di progresso della commessa
    const pct = calcolaProgresso(albero);
    const fill = document.getElementById('commessaProgressFill');
    const plab = document.getElementById('commessaProgressLabel');
    if (fill) { fill.style.width = pct + '%'; fill.classList.toggle('cpb-done', pct >= 100); }
    if (plab) plab.textContent = pct + '%';

    // I materiali CONFERMATI (trascinati sul padre) spariscono come nodo e compaiono come elenco
    // puntato nel padre. Restano nodi: i materiali incompleti E quelli "pronti ma non confermati".
    const matArr = item => (item.tipo === 'lavorazione') ? (item.rich_mat || [])
                         : (item.tipo === 'macchina')   ? (item.materiali_diretti || []) : [];
    const matNodo       = item => matArr(item).filter(m => !m.confermato);   // restano nodi
    const matConfermati = item => matArr(item).filter(m => m.confermato);    // elenco nel padre
    const bulletList = item => {
        const c = matConfermati(item);
        if (!c.length) return '';
        // riga vuota prima dell'elenco e tra le voci, quantità ben distanziata
        return '\n\n' + c.map(m => '✓  ' + (m.codice ?? '-') + '    ×' + m.target).join('\n\n');
    };

    // I materiali (a DESTRA) vengono prima dei sotto-processi, così stanno vicino al loro processo
    function getChildren(item) {
        if (item.tipo === 'commessa')    return item.macchine || [];
        if (item.tipo === 'macchina') {
            if (item.collassata) return [];   // collassata: nessun figlio
            return [...matNodo(item), ...(item.lavorazioni || [])];
        }
        if (item.tipo === 'lavorazione') {
            if (item.confermato) return [];   // processo confermato = collassato, figli nascosti
            return [...matNodo(item), ...(item.figli || [])];
        }
        return [];
    }

    // Layout: la materia prima (foglia) sta a DESTRA, il prodotto finale (commessa) a SINISTRA.
    // Il flusso si legge destra→sinistra; ogni elemento è una colonna più a destra del suo padre.
    const X_SEP = 240, ROW = 64;
    let cy = 0;
    function place(item, depth) {
        const x = depth * X_SEP;
        if (item.tipo === 'macchina' && item.collassata) {
            item._px = x; item._py = cy; cy += ROW; return;   // collassata = foglia compatta
        }
        const ch = getChildren(item);
        if (!ch.length) { item._px = x; item._py = cy; cy += ROW; return; }
        const start = cy;
        ch.forEach(c => place(c, depth + 1));
        item._px = x; item._py = (start + cy - ROW) / 2;
    }
    place(tree, 0);

    const nodes = [], edges = [];
    let nc = 0;
    function addNodo(item, parentId, cmId) {
        const id = ++nc;
        const childCm = (item.tipo === 'macchina') ? item.commessa_macchina_id : cmId;
        let bg, border, fc, bw = 2, label;

        let pronto = false;   // nodo "pronto da confermare" (verde chiaro tratteggiato)
        const confermatiMat = it => matConfermati(it).map(m => ({ rm: m.rich_mat_id, codice: m.codice }));

        if (item.tipo === 'commessa') {
            bg = '#1c1c1c'; border = '#e5006d'; fc = '#fff';
            label = 'Commessa ' + (item.codice ?? '#' + item.id);
            _comNodeMeta[id] = { tipo: 'commessa' };
        } else if (item.tipo === 'macchina') {
            const collassata = !!item.collassata;
            const completa = macchinaCompleta(item);
            if (collassata) {
                bg = '#2e7d32'; border = '#1b5e20'; fc = '#fff';
                label = '✓  ' + (item.codice ?? '-');
            } else if (completa) {
                bg = '#e3f2fd'; border = '#1565c0'; fc = '#0d47a1';   // pronta: trascinala sulla commessa
                label = (item.codice ?? '-') + '  ×' + (item.quantita ?? 1) + '\n[PRONTA ▸ trascina sulla commessa]' + bulletList(item);
            } else {
                bg = '#2b3550'; border = '#5e6b85'; fc = '#fff';
                label = (item.codice ?? '-') + '  ×' + (item.quantita ?? 1) + '\n' + (item.descrizione ?? '').substring(0, 22) + bulletList(item);
            }
            _comNodeMeta[id] = { tipo: 'macchina', cm: childCm, collapsed: collassata, completa: completa,
                                 macchinaId: item.id, codice: item.codice, parentVis: parentId,
                                 confermatiMat: confermatiMat(item) };
        } else if (item.tipo === 'lavorazione') {
            const confermabile = lavConfermabile(item);
            if (item.confermato) {                              // confermato = collassato, verde pieno
                bg = '#2e7d32'; border = '#1b5e20'; fc = '#fff';
                label = '✓  ' + (item.descrizione ?? 'Processo').substring(0, 24);
            } else if (item.bloccato) { bg = '#eceff1'; border = '#b0bec5'; fc = '#90a4ae';
                label = '🔒 ' + (item.descrizione ?? 'Processo').substring(0, 26) + '\n[BLOCCATO]' + bulletList(item);
            } else if (confermabile) { bg = '#e3f2fd'; border = '#1565c0'; fc = '#0d47a1'; pronto = true;
                label = (item.descrizione ?? 'Processo').substring(0, 26) + '\n[PRONTO ▸ trascina sul padre]' + bulletList(item);
            } else if (lavInCorso(item)) { bg = '#fff8e1'; border = '#ffb300'; fc = '#8d6e00';
                label = (item.descrizione ?? 'Processo').substring(0, 26) + '\n[IN CORSO]' + bulletList(item);
            } else { bg = '#f5f5f5'; border = '#bdbdbd'; fc = '#616161';
                label = (item.descrizione ?? 'Processo').substring(0, 26) + '\n[IN ATTESA]' + bulletList(item);
            }
            _comNodeMeta[id] = { tipo: 'lavorazione', cm: childCm, lavId: item.id, parentVis: parentId,
                                 confermato: !!item.confermato, confermabile: confermabile,
                                 confermatiMat: confermatiMat(item) };
        } else { // rich_mat — restano a nodo solo gli incompleti e i "pronti" (completi non confermati)
            const completo = rmCompleto(item);
            if (completo) { bg = '#e3f2fd'; border = '#1565c0'; fc = '#0d47a1'; pronto = true;
                label = (item.codice ?? '-') + '\n' + item.quantita_fornita + '/' + item.target + ' ▸ trascina';
            } else { bg = '#ffffff'; border = '#c5b8f5'; fc = '#5e35b1';
                label = (item.codice ?? '-') + '\n' + item.quantita_fornita + '/' + item.target;
            }
            bw = 1;
            _comNodeMeta[id] = { tipo: 'rich_mat', cm: childCm, rmId: item.rich_mat_id,
                                 completo: completo, parentVis: parentId };
        }

        // riquadro squadrato e compatto per gli elementi "riposti" (collassati/confermati)
        const squared = (item.tipo === 'macchina' && item.collassata) ||
                        (item.tipo === 'lavorazione' && item.confermato);
        nodes.push(Object.assign({
            id, label, shape: 'box', x: item._px, y: item._py,
            color: { background: bg, border, highlight: { background: bg, border: '#e5006d' }, hover: { background: bg, border } },
            font: { color: fc, size: 12, face: 'Poppins, sans-serif', multi: false },
            borderWidth: pronto ? 2 : bw, borderWidthSelected: (pronto ? 2 : bw) + 1
        },
        pronto  ? { shapeProperties: { borderDashes: [6, 4] } } : {},
        squared ? { shapeProperties: { borderRadius: 2 }, widthConstraint: { minimum: 72, maximum: 130 }, font: { color: fc, size: 12, face: 'Poppins, sans-serif', bold: true } } : {}));
        // freccia invertita: punta dal figlio (destra) verso il padre (sinistra), cioè verso il prodotto finale
        if (parentId !== null) edges.push({ from: id, to: parentId });
        getChildren(item).forEach(c => addNodo(c, id, childCm));
        return id;
    }
    addNodo(tree, null, null);

    _visCommessa = new vis.Network(
        container,
        { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) },
        {
            layout:  { hierarchical: false },
            physics: { enabled: false },
            nodes: {
                shape: 'box',
                shapeProperties: { borderRadius: 10 },
                margin: 12,
                widthConstraint: { minimum: 96, maximum: 210 },
                shadow: { enabled: true, size: 8, x: 0, y: 3, color: 'rgba(0,0,0,0.13)' }
            },
            edges: {
                color: { color: '#cdd2db', highlight: '#e5006d', hover: '#e5006d' },
                width: 1.5, selectionWidth: 0.5,
                arrows: { to: { enabled: true, scaleFactor: 0.55 } },
                smooth: { type: 'cubicBezier', forceDirection: 'horizontal', roundness: 0.55 }
            },
            interaction: { hover: true, dragNodes: true, dragView: true, zoomView: true, navigationButtons: true, keyboard: false, tooltipDelay: 120 }
        }
    );

    // Legenda colori + suggerimento drag
    const legend = document.createElement('div');
    legend.className = 'bom-legend';
    legend.innerHTML =
        '<span class="dot dot-attesa"></span>In attesa' +
        '<span class="dot dot-corso"></span>In corso' +
        '<span class="dot dot-pronto"></span>Pronto (trascina sul padre)' +
        '<span class="dot dot-done"></span>Confermato' +
        '<span class="dot dot-lock"></span>Bloccato' +
        '<span class="bom-legend-hint"><i class="fa-solid fa-hand-pointer"></i> trascina un elemento PRONTO sul suo padre per confermare l\'avanzamento</span>';
    container.appendChild(legend);

    // Pulsante ricentra
    const fitBtn = document.createElement('button');
    fitBtn.className = 'bom-fit-btn';
    fitBtn.title = 'Ricentra';
    fitBtn.innerHTML = '<i class="fa-solid fa-expand"></i>';
    fitBtn.addEventListener('click', () => { if (_visCommessa) _visCommessa.fit({ animation: true }); });
    container.appendChild(fitBtn);

    // DRAG&DROP = CONFERMA MANUALE DELL'AVANZAMENTO:
    //  - un MATERIALE "pronto" (completo in scaffalatura) trascinato sul suo padre → confermato
    //  - un PROCESSO "pronto" (tutti i figli confermati) trascinato sul suo padre → confermato
    //  - una MACCHINA completa trascinata sulla commessa → riposta (collassata)
    // Solo gli elementi confermati contano nel progresso. Niente snap = il nodo torna al suo posto.
    _visCommessa.on('dragEnd', params => {
        if (!params.nodes.length) return;
        const meta = _comNodeMeta[params.nodes[0]];
        if (!meta) return;
        const snap = () => caricaAlberoCommessa(_commessaCorrente);

        const cpos = _visCommessa.DOMtoCanvas(params.pointer.DOM);
        const PAD = 30;
        const dentro = (visId, pad = PAD) => {
            if (visId == null) return false;
            try {
                const bb = _visCommessa.getBoundingBox(Number(visId));
                return bb && cpos.x >= bb.left - pad && cpos.x <= bb.right + pad
                          && cpos.y >= bb.top - pad && cpos.y <= bb.bottom + pad;
            } catch (e) { return false; }
        };

        if (meta.tipo === 'rich_mat') {
            if (meta.completo && dentro(meta.parentVis)) confermaAvanzamento(meta.cm, 'rich_mat', meta.rmId);
            else snap();
        } else if (meta.tipo === 'lavorazione') {
            if (meta.confermabile && dentro(meta.parentVis)) confermaAvanzamento(meta.cm, 'lavorazione', meta.lavId);
            else snap();
        } else if (meta.tipo === 'macchina') {
            const comVis = Object.keys(_comNodeMeta).find(k => _comNodeMeta[k].tipo === 'commessa');
            if (meta.completa && !meta.collapsed && dentro(comVis)) collassaMacchina(meta.cm, true);
            else snap();
        } else snap();
    });

    // CLICK = menu contestuale per ANNULLARE una conferma (se si è sbagliato) o gestire la macchina.
    _visCommessa.on('click', params => {
        chiudiComMenu();
        if (!params.nodes.length) return;
        const meta = _comNodeMeta[params.nodes[0]];
        if (!meta) return;
        const items = [];

        if (meta.tipo === 'macchina' && meta.collapsed) {
            items.push({ label: 'Storico lavorazioni', icon: 'fa-eye', action: () => apriStoricoMacchina(meta.macchinaId, meta.codice) });
            items.push({ label: 'Riapri macchina', icon: 'fa-up-right-and-down-left-from-center', action: () => collassaMacchina(meta.cm, false) });
        } else if (meta.tipo === 'lavorazione' && meta.confermato) {
            items.push({ label: 'Annulla conferma processo', icon: 'fa-rotate-left', action: () => annullaAvanzamento(meta.cm, 'lavorazione', meta.lavId) });
        } else {
            // su un padre non collassato: annulla la conferma dei suoi materiali (i pallini ✓)
            (meta.confermatiMat || []).forEach(m =>
                items.push({ label: 'Annulla materiale: ' + (m.codice ?? '-'), icon: 'fa-rotate-left',
                             action: () => annullaAvanzamento(meta.cm, 'rich_mat', m.rm) }));
        }
        if (items.length) mostraComMenu(items, params.pointer.DOM);
    });

    setTimeout(() => { if (_visCommessa) { _visCommessa.redraw(); _visCommessa.fit(); } }, 250);
}

function chiudiComMenu() {
    const ex = document.getElementById('comEditPanel');
    if (ex) ex.remove();
}

function mostraComMenu(items, domPos) {
    const graph = document.getElementById('commessaBomGraph');
    if (!graph) return;
    const panel = document.createElement('div');
    panel.id = 'comEditPanel';
    panel.className = 'bom-edit-panel';
    panel.innerHTML = items.map((it, i) =>
        '<button data-i="' + i + '"><i class="fa-solid ' + (it.icon || 'fa-rotate-left') + '"></i> ' + it.label + '</button>'
    ).join('');
    graph.appendChild(panel);
    const maxX = graph.clientWidth - panel.offsetWidth - 8;
    const maxY = graph.clientHeight - panel.offsetHeight - 8;
    panel.style.left = Math.max(8, Math.min(domPos.x, maxX)) + 'px';
    panel.style.top  = Math.max(8, Math.min(domPos.y, maxY)) + 'px';
    panel.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const it = items[Number(b.dataset.i)];
        chiudiComMenu();
        if (typeof it.action === 'function') it.action();
    }));
}

document.getElementById('commessaPanelClose').addEventListener('click', chiudiVistaCommessa);
document.getElementById('commessaOverlay').addEventListener('click', function(e) {
    if (e.target === this) chiudiVistaCommessa();
});

// Vai dalla vista commessa alla scaffalatura (cella) della stessa commessa
const _btnToScaffale = document.getElementById('commessaToScaffale');
if (_btnToScaffale) _btnToScaffale.addEventListener('click', () => {
    if (_commessaCorrente) window.location.href = 'scaffalatura.html?commessa=' + _commessaCorrente;
});

// Apertura automatica del grafo commessa quando si arriva da un link esterno (?commessaGrafo=<id>)
(async function _autoApriGrafoCommessa() {
    const idc = new URLSearchParams(window.location.search).get('commessaGrafo');
    if (!idc) return;
    const res = await apiFetch('/commesse');
    if (!res || !res.ok) return;
    const comm = (await res.json()).find(c => String(c.id) === String(idc));
    if (comm) apriVistaCommessa(comm);
})();
