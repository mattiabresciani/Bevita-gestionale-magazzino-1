const API = 'http://localhost:5001';
const token = localStorage.getItem('token');
if (!token) window.location.href = 'login.html';

let sezioneCorrente = 'commesse';

// ── UTILITY ───────────────────────────────────────────────────────────────────

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
        localStorage.clear();
        window.location.href = 'login.html';
        return null;
    }
    return res;
}

function statoClass(stato) {
    if (stato === 'COMPLETATA') return 'badge-completata';
    if (stato === 'IN_CORSO')   return 'badge-corso';
    return 'badge-attesa';
}

// ── RICERCA ───────────────────────────────────────────────────────────────────

document.getElementById('searchInput').addEventListener('input', function () {
    const q = this.value.toLowerCase();
    document.querySelectorAll('.item-code').forEach(el => {
        const card = el.closest('.commessa-card-accordion, .commessa-card');
        if (card) card.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
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
        'lavorazioni': '/lavorazioni', 'materie-prime': '/materiale'
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
    else if (sezione === 'materie-prime') renderMateriale(dati, container);

    attaccaEventiCard();
}

// ── RENDER COMMESSE ───────────────────────────────────────────────────────────

function renderCommesse(dati, container) {
    dati.forEach(c => {
        const statoClass = c.stato === 'CHIUSA' ? 'badge badge-chiusa' : 'badge badge-aperta';
        const div = document.createElement('div');
        div.className = 'commessa-card-accordion';
        div.dataset.id = c.id ?? '';
        div.dataset.record = JSON.stringify(c);
        div.dataset.sezione = 'commesse';
        div.innerHTML =
            '<div class="accordion-header">' +
                '<span class="accordion-arrow">&#x203A;</span>' +
                '<span class="item-code commessa-code">' + (c.codice ?? '-') + '</span>' +
                '<div class="accordion-badges">' +
                    '<span class="badge">' + (c.descrizione ?? '-') + '</span>' +
                    '<span class="badge">' + (c.anno ?? '-') + '</span>' +
                    (c.data_consegna ? '<span class="badge"><i class="fa-regular fa-calendar"></i> ' + c.data_consegna + '</span>' : '') +
                    '<span class="' + statoClass + '">' + (c.stato ?? '-') + '</span>' +
                '</div>' +
                '<div class="card-actions">' +
                    '<button class="action-btn edit-btn btn-modifica" title="Modifica"><i class="fa-solid fa-pen"></i></button>' +
                    '<button class="action-btn delete-btn btn-elimina" title="Elimina"><i class="fa-solid fa-trash"></i></button>' +
                '</div>' +
            '</div>' +
            '<div class="accordion-panel">' +
                '<div class="tree-container" id="tree-commessa-' + c.id + '">' +
                    '<p class="tree-empty">Apri per vedere le macchine associate.</p>' +
                '</div>' +
            '</div>';
        container.appendChild(div);

        div.querySelector('.accordion-header').addEventListener('click', function(e) {
            if (!e.target.closest('.card-actions')) {
                toggleAccordion(this);
                if (div.classList.contains('active')) caricaMacchineCommessa(c.id);
            }
        });
    });
}

// ── RENDER MACCHINE ───────────────────────────────────────────────────────────

function renderMacchine(dati, container) {
    const hdr = document.createElement('div');
    hdr.className = 'cards-col-header header-mac';
    hdr.innerHTML =
        '<span class="th-arrow-spacer"></span>' +
        '<span class="th th-codice">Codice</span>' +
        '<span class="th th-desc">Descrizione</span>' +
        '<span class="th th-qty">Qtà</span>' +
        '<span class="th th-act">Azioni</span>';
    container.appendChild(hdr);

    dati.forEach(m => {
        const sc = statoClass(m.stato);
        const div = document.createElement('div');
        div.className = 'commessa-card-accordion';
        div.dataset.id = m.id ?? '';
        div.dataset.record = JSON.stringify(m);
        div.dataset.sezione = 'macchine';
        div.innerHTML =
            '<div class="accordion-header">' +
                '<span class="accordion-arrow">&#x203A;</span>' +
                '<button class="item-code commessa-code machine-link-btn" title="Apri scheda">' + (m.codice ?? '-') + '</button>' +
                '<div class="accordion-badges">' +
                    '<span class="badge">' + (m.descrizione ?? '-') + '</span>' +
                    '<span class="badge badge-commessa">Comm. #' + (m.id_commessa ?? '-') + '</span>' +
                    '<span class="badge ' + sc + '">' + (m.stato ?? '-') + '</span>' +
                '</div>' +
                '<span class="qty-display">' + (m.quantita ?? 0) + '</span>' +
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

function renderLavorazioni(dati, container) {
    dati.forEach(l => {
        const sc = statoClass(l.stato);
        const div = document.createElement('div');
        div.className = 'commessa-card-accordion';
        div.dataset.id = l.id ?? '';
        div.dataset.record = JSON.stringify(l);
        div.dataset.sezione = 'lavorazioni';
        div.innerHTML =
            '<div class="accordion-header">' +
                '<span class="accordion-arrow">&#x203A;</span>' +
                '<span class="item-code commessa-code">' + (l.descrizione ?? '-') + '</span>' +
                '<div class="accordion-badges">' +
                    '<span class="badge badge-commessa">Mac. #' + (l.id_macchina ?? '-') + '</span>' +
                    (l.tav_padre ? '<span class="badge">Padre: #' + l.tav_padre + '</span>' : '<span class="badge">Radice</span>') +
                    '<span class="badge ' + sc + '">' + (l.stato ?? '-') + '</span>' +
                '</div>' +
                '<div class="card-actions">' +
                    '<button class="action-btn edit-btn btn-modifica" title="Modifica"><i class="fa-solid fa-pen"></i></button>' +
                    '<button class="action-btn delete-btn btn-elimina" title="Elimina"><i class="fa-solid fa-trash"></i></button>' +
                '</div>' +
            '</div>' +
            '<div class="accordion-panel">' +
                '<div class="tree-container" id="tree-lavorazione-' + l.id + '">' +
                    '<p class="tree-empty">Apri per vedere i materiali richiesti.</p>' +
                '</div>' +
            '</div>';
        container.appendChild(div);

        div.querySelector('.accordion-header').addEventListener('click', function(e) {
            if (!e.target.closest('.card-actions')) {
                toggleAccordion(this);
                if (div.classList.contains('active')) caricaRichMatLavorazione(l.id);
            }
        });
    });
}

// ── RENDER MATERIE PRIME ──────────────────────────────────────────────────────

function qtyClass(qty) {
    const q = Number(qty) || 0;
    if (q === 0)  return 'qty-danger';
    if (q < 10)   return 'qty-warn';
    return '';
}

function renderMateriale(dati, container) {
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
                '<span class="item-code commessa-code">' + (m.codice ?? '-') + '</span>' +
            '</div>' +
            '<div class="card-right">' +
                '<span class="badge">' + (m.descrizione ?? '-') + '</span>' +
            '</div>' +
            '<span class="qty-display ' + qtyClass(m.quantita) + '">' + (m.quantita ?? 0) + '</span>' +
            '<div class="card-actions card-actions-right">' +
                '<button class="action-btn edit-btn btn-modifica" title="Modifica"><i class="fa-solid fa-pen"></i></button>' +
                '<button class="action-btn delete-btn btn-elimina" title="Elimina"><i class="fa-solid fa-trash"></i></button>' +
            '</div>';
        container.appendChild(div);
    });
}

// ── ACCORDION CONTENT ─────────────────────────────────────────────────────────

async function caricaMacchineCommessa(idCommessa) {
    const tree = document.getElementById('tree-commessa-' + idCommessa);
    if (!tree) return;
    tree.innerHTML = '<p class="tree-empty">Caricamento...</p>';

    const res = await apiFetch('/commesse/' + idCommessa + '/macchine');
    if (!res) return;
    const macchine = await res.json();

    if (!macchine.length) {
        tree.innerHTML = '<p class="tree-empty">Nessuna macchina associata.</p>';
        aggiornaAltezzaPanel(tree);
        return;
    }

    tree.innerHTML = '';
    const branch = document.createElement('div');
    branch.className = 'tree-branch';
    branch.appendChild(Object.assign(document.createElement('span'), { className: 'tree-line' }));

    macchine.forEach(m => {
        const item = document.createElement('div');
        item.className = 'tree-item';
        item.innerHTML =
            '<span class="tree-dot">&#9632;</span>' +
            '<button class="material-code machine-link-btn">' + (m.codice ?? '-') + '</button>' +
            '<span class="material-quantity">' + (m.descrizione ?? '') + '</span>' +
            '<span class="material-quantity badge ' + statoClass(m.stato) + '">' + (m.stato ?? '-') + '</span>' +
            '<span class="material-quantity">Qt. ' + (m.quantita ?? '-') + '</span>';
        item.querySelector('.machine-link-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            apriSchedaMacchina(m);
        });
        branch.appendChild(item);
    });

    tree.appendChild(branch);
    aggiornaAltezzaPanel(tree);
}

async function caricaLavorazioniMacchina(idMacchina) {
    const tree = document.getElementById('tree-macchina-' + idMacchina);
    if (!tree) return;
    tree.innerHTML = '<p class="tree-empty">Caricamento...</p>';

    const res = await apiFetch('/macchine/' + idMacchina + '/lavorazioni');
    if (!res) return;
    const lavorazioni = await res.json();

    if (!lavorazioni.length) {
        tree.innerHTML = '<p class="tree-empty">Nessuna lavorazione associata.</p>';
        aggiornaAltezzaPanel(tree);
        return;
    }

    tree.innerHTML = '';
    const branch = document.createElement('div');
    branch.className = 'tree-branch';
    branch.appendChild(Object.assign(document.createElement('span'), { className: 'tree-line' }));

    lavorazioni.forEach(l => {
        const item = document.createElement('div');
        item.className = 'tree-item';
        item.innerHTML =
            '<span class="tree-dot">&#9632;</span>' +
            '<span class="material-code">' + (l.descrizione ?? '-') + '</span>' +
            (l.tav_padre ? '<span class="material-quantity">Padre: #' + l.tav_padre + '</span>' : '<span class="material-quantity">Radice</span>') +
            '<span class="material-quantity badge ' + statoClass(l.stato) + '">' + (l.stato ?? '-') + '</span>';
        branch.appendChild(item);
    });

    tree.appendChild(branch);
    aggiornaAltezzaPanel(tree);
}

async function caricaRichMatLavorazione(idLavorazione) {
    const tree = document.getElementById('tree-lavorazione-' + idLavorazione);
    if (!tree) return;
    tree.innerHTML = '<p class="tree-empty">Caricamento...</p>';

    const res = await apiFetch('/lavorazioni/' + idLavorazione + '/rich_mat');
    if (!res) return;
    const materiali = await res.json();

    tree.innerHTML = '';

    if (materiali.length) {
        const branch = document.createElement('div');
        branch.className = 'tree-branch';
        branch.appendChild(Object.assign(document.createElement('span'), { className: 'tree-line' }));

        materiali.forEach(m => {
            const sufficiente = (m.quantita_stock ?? 0) >= (m.quantita_richiesta ?? 0);
            const stockClass  = sufficiente ? '' : 'qty-danger';
            const item = document.createElement('div');
            item.className = 'tree-item';
            item.innerHTML =
                '<span class="tree-dot">&#9632;</span>' +
                '<span class="material-code">' + (m.codice ?? '-') + '</span>' +
                '<span class="material-quantity">' + (m.descrizione ?? '') + '</span>' +
                '<span class="material-quantity">Ric.: <b>' + (m.quantita_richiesta ?? 1) + '</b></span>' +
                '<span class="material-quantity ' + stockClass + '">Stock: <b>' + (m.quantita_stock ?? 0) + '</b></span>' +
                '<button class="action-btn delete-btn btn-rimuovi-mat" data-id="' + m.id + '" title="Rimuovi">' +
                    '<i class="fa-solid fa-trash"></i>' +
                '</button>';
            item.querySelector('.btn-rimuovi-mat').addEventListener('click', async function() {
                const r = await apiFetch('/rich_mat/' + this.dataset.id, 'DELETE');
                if (r && r.ok) caricaRichMatLavorazione(idLavorazione);
            });
            branch.appendChild(item);
        });
        tree.appendChild(branch);
    } else {
        tree.innerHTML = '<p class="tree-empty">Nessun materiale richiesto.</p>';
    }

    // Form inline — select dal catalogo materiali
    const catalogo = await apiFetch('/materiale');
    const listaMat = (catalogo && catalogo.ok) ? await catalogo.json() : [];

    const addRow = document.createElement('div');
    addRow.className = 'tree-add-row';
    const opzioni = listaMat.map(m =>
        '<option value="' + m.id + '">' + (m.codice ?? '-') + ' — ' + (m.descrizione ?? '') + ' [Stock: ' + (m.quantita ?? 0) + ']</option>'
    ).join('');
    addRow.innerHTML =
        '<select id="rm-sel-' + idLavorazione + '" class="tree-input tree-input-wide">' +
            '<option value="">Seleziona materiale...</option>' + opzioni +
        '</select>' +
        '<input type="number" placeholder="Qt. richiesta" id="rm-qty-' + idLavorazione + '" class="tree-input tree-input-sm" value="1" min="0.01" step="0.01">' +
        '<button class="bom-confirm-btn" id="rm-add-' + idLavorazione + '" title="Aggiungi"><i class="fa-solid fa-plus"></i></button>';
    tree.appendChild(addRow);

    document.getElementById('rm-add-' + idLavorazione).addEventListener('click', async function() {
        const sel = document.getElementById('rm-sel-' + idLavorazione);
        const idMat = sel?.value;
        if (!idMat) { sel?.focus(); return; }
        const qty = parseFloat(document.getElementById('rm-qty-' + idLavorazione).value) || 1;
        this.disabled = true;
        const r = await apiFetch('/lavorazioni/' + idLavorazione + '/rich_mat', 'POST',
            { id_materiale: Number(idMat), quantita: qty });
        this.disabled = false;
        if (r && (r.ok || r.status === 201)) {
            caricaRichMatLavorazione(idLavorazione);
        } else if (r) {
            const err = await r.json().catch(() => ({}));
            alert('Errore: ' + (err.errore || r.status));
        }
    });

    aggiornaAltezzaPanel(tree);
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
        { key: 'codice',      label: 'Codice Macchina', type: 'text',   valoreKey: 'codice' },
        { key: 'descrizione', label: 'Descrizione',     type: 'text',   valoreKey: 'descrizione' },
        { key: 'quantita',    label: 'Quantità',        type: 'number', min: '0', valoreKey: 'quantita' },
        { key: 'id_commessa', label: 'ID Commessa',     type: 'number', min: '1', valoreKey: 'id_commessa' },
        { key: 'stato',       label: 'Stato',           type: 'select', options: ['IN_ATTESA','IN_CORSO','COMPLETATA'], valoreKey: 'stato' }
    ],
    'lavorazioni': [
        { key: 'descrizione', label: 'Descrizione',           type: 'text',   valoreKey: 'descrizione' },
        { key: 'id_macchina', label: 'ID Macchina',           type: 'number', min: '1', valoreKey: 'id_macchina' },
        { key: 'tav_padre',   label: 'ID Lavorazione Padre',  type: 'number', min: '0', valoreKey: 'tav_padre', optional: true },
        { key: 'stato',       label: 'Stato',                 type: 'select', options: ['IN_ATTESA','IN_CORSO','COMPLETATA'], valoreKey: 'stato' }
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
               '<input type="' + campo.type + '" id="field_' + campo.key + '" value="' + (valore ?? '') + '" placeholder="' + campo.label + '"' +
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

    const endpointMap = { 'commesse': '/commesse', 'macchine': '/macchine', 'lavorazioni': '/lavorazioni', 'materie-prime': '/materiale' };
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
    const endpointMap = { 'commesse': '/commesse', 'macchine': '/macchine', 'lavorazioni': '/lavorazioni', 'materie-prime': '/materiale' };
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
    document.getElementById('machineInfoQty').textContent     = m.quantita ?? '-';
    document.getElementById('machineInfoStato').textContent   = m.stato ?? '-';

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

    if (!tree.lavorazioni || !tree.lavorazioni.length) {
        container.innerHTML = '<p class="machine-no-file"><i class="fa-solid fa-diagram-project" style="opacity:.3"></i><br>Nessuna lavorazione associata.</p>';
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
            if (item.tipo === 'macchina')    return item.lavorazioni || [];
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

        function addNodo(item, parentId) {
            const id = ++nc;
            let bg, border, fc, bw, label;

            if (item.tipo === 'macchina') {
                bg = '#1c1c1c'; border = '#e5006d'; fc = '#ffffff'; bw = 2;
                label = (item.codice ?? '') + '\n' + (item.descrizione ?? '').substring(0, 24);
            } else if (item.tipo === 'lavorazione') {
                if (item.stato === 'COMPLETATA')      { bg = '#e8f5e9'; border = '#43a047'; fc = '#1b5e20'; }
                else if (item.stato === 'IN_CORSO')   { bg = '#e3f2fd'; border = '#1e88e5'; fc = '#0d47a1'; }
                else                                   { bg = '#f5f5f5'; border = '#bdbdbd'; fc = '#424242'; }
                bw = 2;
                label = (item.descrizione ?? '').substring(0, 28) + '\n[' + (item.stato ?? '-') + ']';
            } else { // rich_mat
                const ok = (item.quantita_stock ?? 0) >= (item.quantita_richiesta ?? 0);
                bg = ok ? '#fff8e1' : '#fde8e8';
                border = ok ? '#ffb300' : '#e53935';
                fc = ok ? '#5d4037' : '#b71c1c';
                bw = 1;
                label = (item.codice ?? '-') +
                    '\nRic.: ' + (item.quantita_richiesta ?? 1) +
                    '  Stock: ' + (item.quantita_stock ?? 0);
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
        setTimeout(() => { if (_visNetwork) { _visNetwork.redraw(); _visNetwork.fit(); } }, 300);

    } catch (err) {
        container.innerHTML = '<p class="machine-no-file">Errore grafo: ' + err.message + '</p>';
    }
}

function chiudiSchedaMacchina() {
    if (document.fullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    document.getElementById('machineOverlay').classList.remove('open');
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
