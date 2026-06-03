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
        container.appendChild(div);

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
                '<button class="item-code commessa-code machine-link-btn" title="Apri scheda">' + (m.codice ?? '-') + '</button>' +
                '<div class="accordion-badges">' +
                    '<span class="badge">' + (m.descrizione ?? '-') + '</span>' +
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
                '<span class="item-code commessa-code">' + (p.descrizione ?? '-') + '</span>' +
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
        div.innerHTML =
            '<div class="accordion-header">' +
                '<span class="accordion-arrow">&#x203A;</span>' +
                '<span class="item-code commessa-code">' + (s.codice || s.descrizione || '-') + '</span>' +
                '<div class="accordion-badges">' +
                    '<span class="badge">' + (s.descrizione ?? '-') + '</span>' +
                    '<span class="badge badge-commessa"><i class="fa-solid fa-screwdriver-wrench"></i> ' + (s.processo ?? 'processo non impostato') + '</span>' +
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
    procRow.innerHTML =
        '<label style="font-size:13px;color:#555;">Lavorazione:</label>' +
        '<select id="sl-proc-' + idSem + '" class="tree-input tree-input-wide">' +
            '<option value="">— Seleziona processo —</option>' +
            processi.map(p => '<option value="' + p.id + '"' + (rec.id_processo === p.id ? ' selected' : '') + '>' + (p.descrizione ?? '-') + '</option>').join('') +
        '</select>';
    tree.appendChild(procRow);
    document.getElementById('sl-proc-' + idSem).addEventListener('change', async function() {
        await apiFetch('/semilavorati/' + idSem, 'PUT', { id_processo: this.value ? Number(this.value) : null });
        caricaSezione('semilavorati');
    });

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
                '<span class="material-code">' + (co.codice || co.descrizione || '-') + '</span> ' + tag +
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

    // 3) Form aggiunta componente (materia prima o altro semilavorato)
    const addRow = document.createElement('div');
    addRow.className = 'tree-add-row';
    const optMat = materiali.map(m => '<option value="m' + m.id + '">' + (m.codice ?? '-') + ' — ' + (m.descrizione ?? '') + '</option>').join('');
    const optSl  = semilav.filter(x => x.id !== idSem).map(x => '<option value="s' + x.id + '">' + (x.codice || x.descrizione || '-') + ' (semilav.)</option>').join('');
    addRow.innerHTML =
        '<select id="sl-comp-' + idSem + '" class="tree-input tree-input-wide">' +
            '<option value="">Aggiungi componente...</option>' +
            '<optgroup label="Materie prime">' + optMat + '</optgroup>' +
            (optSl ? '<optgroup label="Semilavorati">' + optSl + '</optgroup>' : '') +
        '</select>' +
        '<input type="number" id="sl-cq-' + idSem + '" class="tree-input tree-input-sm" value="1" min="0.01" step="0.01">' +
        '<button class="bom-confirm-btn" id="sl-cadd-' + idSem + '" title="Aggiungi"><i class="fa-solid fa-plus"></i></button>';
    tree.appendChild(addRow);

    document.getElementById('sl-cadd-' + idSem).addEventListener('click', async function() {
        const val = document.getElementById('sl-comp-' + idSem).value;
        if (!val) return;
        const qty = parseFloat(document.getElementById('sl-cq-' + idSem).value) || 1;
        const body = { quantita: qty };
        if (val[0] === 'm') body.id_materiale = Number(val.slice(1));
        else body.id_semilavorato_comp = Number(val.slice(1));
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
                '<button class="material-code machine-link-btn">' + (m.codice ?? '-') + '</button>' +
                '<span class="material-quantity">' + (m.descrizione ?? '') + '</span>' +
                '<span class="material-quantity badge ' + statoClass(m.stato) + '">' + (m.stato ?? '-') + '</span>' +
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
    const opzioni = listaMac.map(m =>
        '<option value="' + m.id + '">' + (m.codice ?? '-') + ' — ' + (m.descrizione ?? '') + '</option>'
    ).join('');
    addRow.innerHTML =
        '<select id="mc-sel-' + idCommessa + '" class="tree-input tree-input-wide">' +
            '<option value="">Seleziona macchina...</option>' + opzioni +
        '</select>' +
        '<input type="number" placeholder="Qtà" id="mc-qty-' + idCommessa + '" class="tree-input tree-input-sm" value="1" min="1" step="1">' +
        '<select id="mc-stato-' + idCommessa + '" class="tree-input">' +
            '<option value="IN_ATTESA">IN_ATTESA</option>' +
            '<option value="IN_CORSO">IN_CORSO</option>' +
            '<option value="COMPLETATA">COMPLETATA</option>' +
        '</select>' +
        '<button class="bom-confirm-btn" id="mc-add-' + idCommessa + '" title="Aggiungi macchina"><i class="fa-solid fa-plus"></i></button>';
    tree.appendChild(addRow);

    document.getElementById('mc-add-' + idCommessa).addEventListener('click', async function() {
        const sel = document.getElementById('mc-sel-' + idCommessa);
        const idMac = sel?.value;
        if (!idMac) { sel?.focus(); return; }
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
    const cont = document.createElement('div');
    cont.className = 'albero-macchina';

    function rigaMateriale(rm, depth) {
        const row = document.createElement('div');
        row.className = 'albero-row tipo-materiale';
        row.style.marginLeft = (depth * 22) + 'px';
        row.innerHTML =
            '<span class="albero-chip chip-materiale"><i class="fa-solid fa-cube"></i> Materiale</span>' +
            '<span class="albero-nome">' + (rm.codice ?? '-') + '</span>' +
            '<span class="albero-desc">' + (rm.descrizione ?? '') + '</span>' +
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
            '<span class="albero-nome">' + (lav.descrizione ?? '-') + '</span>';
        cont.appendChild(row);
        (lav.rich_mat || []).forEach(rm => rigaMateriale(rm, depth + 1));
        (lav.figli || []).forEach(f => rigaLavorazione(f, depth + 1));
    }

    (alb.lavorazioni || []).forEach(l => rigaLavorazione(l, 0));

    if (haDir) {
        const sep = document.createElement('div');
        sep.className = 'albero-sep';
        sep.textContent = 'Materiali diretti della macchina';
        cont.appendChild(sep);
        alb.materiali_diretti.forEach(rm => rigaMateriale(rm, 0));
    }

    tree.appendChild(cont);
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

    const procOpts = processi.map(p => '<option value="' + p.id + '">' + (p.descrizione ?? '-') + '</option>').join('');
    const matOpts  = materiali.map(m => '<option value="' + m.id + '">' + (m.codice ?? '-') + ' — ' + (m.descrizione ?? '') + '</option>').join('');
    const semOpts  = semilav.map(s => '<option value="' + s.id + '">' + (s.codice || s.descrizione || '-') + '</option>').join('');
    const lavOpts  = lavs.map(l => '<option value="' + l.id + '">' + (l.descrizione ?? ('#' + l.id)) + '</option>').join('');

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
                '<select id="el_proc"><option value="">Seleziona...</option>' + procOpts + '</select></div>' +
            '<div class="modal-field el-proc"><label>Processo precedente</label>' +
                '<select id="el_prec"><option value="">— Nessuno (iniziale) —</option>' + lavOpts + '</select></div>' +
            '<div class="modal-field el-mat"><label>Materia prima</label>' +
                '<select id="el_mat"><option value="">Seleziona...</option>' + matOpts + '</select></div>' +
            '<div class="modal-field el-sem"><label>Semilavorato</label>' +
                '<select id="el_sem"><option value="">Seleziona...</option>' + semOpts + '</select></div>' +
            '<div class="modal-field el-comp"><label>Quantità</label>' +
                '<input type="number" id="el_qty" value="1" min="0.01" step="0.01"></div>' +
            '<div class="modal-field el-comp"><label>Posizione</label>' +
                '<select id="el_pos"><option value="diretto">Diretta sulla macchina</option><option value="sotto">Sotto un processo</option></select></div>' +
            '<div class="modal-field el-comp el-sotto"><label>Processo</label>' +
                '<select id="el_lav"><option value="">Seleziona...</option>' + lavOpts + '</select></div>' +
        '</div>' +
        '<div class="modal-footer"><button class="modal-btn-cancel">Annulla</button>' +
        '<button class="modal-btn-save">Salva</button></div></div>';
    document.body.appendChild(ov);

    const $  = s => ov.querySelector(s);
    const hide = (sel, h) => ov.querySelectorAll(sel).forEach(e => e.style.display = h ? 'none' : '');
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
    if (opts.parent)    $('#el_prec').value = opts.parent;
    if (opts.posizione) $('#el_pos').value  = opts.posizione;
    if (opts.targetLav) $('#el_lav').value  = opts.targetLav;
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
                const idMat = $('#el_mat').value;
                if (!idMat) { alert('Seleziona una materia prima.'); return; }
                const payload = { id_materiale: Number(idMat), quantita: qty };
                r = sotto ? await apiFetch('/lavorazioni/' + idLav + '/rich_mat', 'POST', payload)
                          : await apiFetch('/macchine/' + idMac + '/rich_mat', 'POST', payload);
            } else { // semilavorato
                const idSem = $('#el_sem').value;
                if (!idSem) { alert('Seleziona un semilavorato.'); return; }
                const payload = { id_semilavorato: Number(idSem), quantita: qty };
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
let _machineCollassate = new Set();   // commessa_macchina_id collassati (macchine completate "riposte")

// Una lavorazione è completa se il suo stato è COMPLETATA e tutti i sotto-processi lo sono
function lavTuttoCompleto(lav) {
    if (lav.stato !== 'COMPLETATA') return false;
    return (lav.figli || []).every(lavTuttoCompleto);
}
// Una macchina è completa se tutti i processi sono completati e tutti i materiali diretti forniti
function macchinaCompleta(m) {
    const procOk = (m.lavorazioni || []).every(lavTuttoCompleto);
    const dirOk  = (m.materiali_diretti || []).every(d => d.quantita_fornita >= d.target);
    const haQualcosa = (m.lavorazioni || []).length || (m.materiali_diretti || []).length;
    return haQualcosa && procOk && dirOk;
}
// Progresso commessa = unità fornite / unità totali su tutti i materiali (foglia)
function calcolaProgresso(albero) {
    let forn = 0, tot = 0;
    const visitaLav = lav => {
        (lav.rich_mat || []).forEach(r => { forn += Math.min(r.quantita_fornita, r.target); tot += r.target; });
        (lav.figli || []).forEach(visitaLav);
    };
    (albero.macchine || []).forEach(m => {
        (m.lavorazioni || []).forEach(visitaLav);
        (m.materiali_diretti || []).forEach(r => { forn += Math.min(r.quantita_fornita, r.target); tot += r.target; });
    });
    return tot > 0 ? Math.round(100 * forn / tot) : 0;
}

function apriVistaCommessa(c) {
    _commessaCorrente = c.id;
    _machineCollassate = new Set();
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

    // I materiali COMPLETI spariscono come nodo e compaiono come elenco puntato nel padre;
    // restano nodi (trascinabili) solo i materiali ancora INCOMPLETI.
    const matArr = item => (item.tipo === 'lavorazione') ? (item.rich_mat || [])
                         : (item.tipo === 'macchina')   ? (item.materiali_diretti || []) : [];
    const matIncompleti = item => matArr(item).filter(m => m.quantita_fornita < m.target);
    const matCompleti   = item => matArr(item).filter(m => m.quantita_fornita >= m.target);
    const bulletList = item => {
        const c = matCompleti(item);
        if (!c.length) return '';
        // riga vuota prima dell'elenco e tra le voci, quantità ben distanziata
        return '\n\n' + c.map(m => '•  ' + (m.codice ?? '-') + '    ×' + m.target).join('\n\n');
    };

    function getChildren(item) {
        if (item.tipo === 'commessa')    return item.macchine || [];
        if (item.tipo === 'macchina') {
            if (_machineCollassate.has(item.commessa_macchina_id)) return [];   // collassata: nessun figlio
            return [...(item.lavorazioni || []), ...matIncompleti(item)];
        }
        if (item.tipo === 'lavorazione') return [...(item.figli || []), ...matIncompleti(item)];
        return [];
    }

    // Layout: processi in sequenza verso destra; i MATERIALI di un processo
    // elencati a lista verticale subito SOTTO la targhetta del processo.
    const X_SEP = 240, ROW = 64, MAT_INDENT = 36;
    let cy = 0;
    function place(item, depth) {
        const x = depth * X_SEP;
        if (item.tipo === 'rich_mat') {
            item._px = x; item._py = cy; cy += ROW; return;
        }
        if (item.tipo === 'lavorazione') {
            // la targhetta del processo in cima, poi i materiali INCOMPLETI sotto, poi i sotto-processi a destra
            item._px = x; item._py = cy; cy += ROW;
            matIncompleti(item).forEach(mt => { mt._px = x + MAT_INDENT; mt._py = cy; cy += ROW; });
            (item.figli || []).forEach(f => place(f, depth + 1));
            return;
        }
        if (item.tipo === 'macchina') {
            if (_machineCollassate.has(item.commessa_macchina_id)) {
                item._px = x; item._py = cy; cy += ROW; return;   // collassata = foglia compatta
            }
            // materiali diretti incompleti sotto la macchina, processi a destra
            item._px = x; item._py = cy; cy += ROW;
            matIncompleti(item).forEach(mt => { mt._px = x + MAT_INDENT; mt._py = cy; cy += ROW; });
            (item.lavorazioni || []).forEach(l => place(l, depth + 1));
            return;
        }
        // commessa: centrata verticalmente sui figli
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

        if (item.tipo === 'commessa') {
            bg = '#1c1c1c'; border = '#e5006d'; fc = '#fff';
            label = 'Commessa ' + (item.codice ?? '#' + item.id);
            _comNodeMeta[id] = { tipo: 'commessa' };
        } else if (item.tipo === 'macchina') {
            const collassata = _machineCollassate.has(item.commessa_macchina_id);
            const completa = macchinaCompleta(item);
            if (collassata) {
                bg = '#2e7d32'; border = '#1b5e20'; fc = '#fff';
                label = '✓  ' + (item.codice ?? '-');
            } else {
                bg = '#2b3550'; border = '#5e6b85'; fc = '#fff';
                label = (item.codice ?? '-') + '  ×' + (item.quantita ?? 1) + '\n' + (item.descrizione ?? '').substring(0, 22) + bulletList(item);
            }
            _comNodeMeta[id] = { tipo: 'macchina', cm: childCm, collapsed: collassata, completa: completa,
                                 completi: matCompleti(item).map(m => ({ rm: m.rich_mat_id, codice: m.codice })) };
        } else if (item.tipo === 'lavorazione') {
            if (item.bloccato)                    { bg = '#eceff1'; border = '#b0bec5'; fc = '#90a4ae'; }
            else if (item.stato === 'COMPLETATA') { bg = '#e8f5e9'; border = '#43a047'; fc = '#1b5e20'; }
            else if (item.stato === 'IN_CORSO')   { bg = '#fff8e1'; border = '#ffb300'; fc = '#8d6e00'; }
            else                                  { bg = '#f5f5f5'; border = '#bdbdbd'; fc = '#616161'; }
            label = (item.bloccato ? '🔒 ' : '') + (item.descrizione ?? 'Processo').substring(0, 26) +
                    '\n[' + (item.bloccato ? 'BLOCCATO' : item.stato) + ']' + bulletList(item);
            _comNodeMeta[id] = { tipo: 'lavorazione', cm: childCm, completi: matCompleti(item).map(m => ({ rm: m.rich_mat_id, codice: m.codice })) };
        } else { // rich_mat
            const completo = (item.quantita_fornita >= item.target);
            const senza = (item.quantita_stock ?? 0) <= 0;
            if (completo)   { bg = '#e8f5e9'; border = '#43a047'; fc = '#1b5e20'; }
            else if (senza) { bg = '#fde8e8'; border = '#e53935'; fc = '#b71c1c'; }
            else            { bg = '#ffffff'; border = '#c5b8f5'; fc = '#5e35b1'; }
            bw = 1;
            label = (item.codice ?? '-') + '\n' + item.quantita_fornita + '/' + item.target + (completo ? ' ✓' : '') +
                    '\nstock ' + (item.quantita_stock ?? 0);
            _comNodeMeta[id] = { tipo: 'rich_mat', rm: item.rich_mat_id, cm: childCm, targetVisId: parentId, fornito: item.quantita_fornita, codice: item.codice };
        }

        // macchina collassata = riquadro squadrato e compatto
        const squared = (item.tipo === 'macchina' && _machineCollassate.has(item.commessa_macchina_id));
        nodes.push(Object.assign({
            id, label, shape: 'box', x: item._px, y: item._py,
            color: { background: bg, border, highlight: { background: bg, border: '#e5006d' }, hover: { background: bg, border } },
            font: { color: fc, size: 12, face: 'Poppins, sans-serif', multi: false },
            borderWidth: bw, borderWidthSelected: bw + 1
        }, squared ? { shapeProperties: { borderRadius: 2 }, widthConstraint: { minimum: 72, maximum: 130 }, font: { color: fc, size: 12, face: 'Poppins, sans-serif', bold: true } } : {}));
        if (parentId !== null) edges.push({ from: parentId, to: id });
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
        '<span class="dot dot-done"></span>Completato' +
        '<span class="dot dot-lock"></span>Bloccato' +
        '<span class="bom-legend-hint"><i class="fa-solid fa-arrow-pointer"></i> trascina un materiale sul suo processo</span>';
    container.appendChild(legend);

    // Pulsante ricentra
    const fitBtn = document.createElement('button');
    fitBtn.className = 'bom-fit-btn';
    fitBtn.title = 'Ricentra';
    fitBtn.innerHTML = '<i class="fa-solid fa-expand"></i>';
    fitBtn.addEventListener('click', () => { if (_visCommessa) _visCommessa.fit({ animation: true }); });
    container.appendChild(fitBtn);

    // DRAG&DROP:
    //  - nodo MATERIALE sul suo processo/macchina → rifornisce 1 unità
    //  - nodo MACCHINA completata sulla commessa → la "ripone" (collassa in un riquadro a sinistra)
    _visCommessa.on('dragEnd', params => {
        if (!params.nodes.length) return;
        const dragged = params.nodes[0];
        const meta = _comNodeMeta[dragged];
        if (!meta) return;
        const cpos = _visCommessa.DOMtoCanvas(params.pointer.DOM);
        const pos = _visCommessa.getPositions();
        let nearest = null, best = Infinity;
        Object.keys(pos).forEach(k => {
            const nid = Number(k);
            if (nid === dragged) return;
            const d = Math.hypot(pos[nid].x - cpos.x, pos[nid].y - cpos.y);
            if (d < best) { best = d; nearest = nid; }
        });
        const nearMeta = nearest !== null ? _comNodeMeta[nearest] : null;

        if (meta.tipo === 'rich_mat') {
            if (nearest !== null && best < 95 && nearest === meta.targetVisId) fornisciMateriale(meta.cm, meta.rm);
            else caricaAlberoCommessa(_commessaCorrente);   // snap-back
            return;
        }
        if (meta.tipo === 'macchina' && meta.completa && !meta.collapsed) {
            if (nearMeta && nearMeta.tipo === 'commessa' && best < 140) {
                _machineCollassate.add(meta.cm);
            }
            caricaAlberoCommessa(_commessaCorrente);
        }
    });

    // CLICK:
    //  - macchina collassata → riaprila
    //  - materiale/targhetta con materiali completati → menu "Restituisci 1"
    _visCommessa.on('click', params => {
        chiudiComMenu();
        if (!params.nodes.length) return;
        const meta = _comNodeMeta[params.nodes[0]];
        if (!meta) return;
        if (meta.tipo === 'macchina' && meta.collapsed) {
            _machineCollassate.delete(meta.cm);
            caricaAlberoCommessa(_commessaCorrente);
            return;
        }
        let items = [];
        if (meta.tipo === 'rich_mat' && meta.fornito > 0) {
            items = [{ label: 'Restituisci 1: ' + (meta.codice ?? ''), cm: meta.cm, rm: meta.rm }];
        } else if ((meta.tipo === 'lavorazione' || meta.tipo === 'macchina') && meta.completi && meta.completi.length) {
            items = meta.completi.map(c => ({ label: 'Restituisci 1: ' + (c.codice ?? ''), cm: meta.cm, rm: c.rm }));
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
        '<button data-i="' + i + '"><i class="fa-solid fa-rotate-left"></i> ' + it.label + '</button>'
    ).join('');
    graph.appendChild(panel);
    const maxX = graph.clientWidth - panel.offsetWidth - 8;
    const maxY = graph.clientHeight - panel.offsetHeight - 8;
    panel.style.left = Math.max(8, Math.min(domPos.x, maxX)) + 'px';
    panel.style.top  = Math.max(8, Math.min(domPos.y, maxY)) + 'px';
    panel.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const it = items[Number(b.dataset.i)];
        chiudiComMenu();
        restituisciMateriale(it.cm, it.rm);
    }));
}

async function fornisciMateriale(cmId, rmId) {
    const res = await apiFetch('/commessa-macchine/' + cmId + '/rich_mat/' + rmId + '/fornisci', 'POST', {});
    if (res && res.ok) {
        if (_commessaCorrente) caricaAlberoCommessa(_commessaCorrente);
    } else if (res) {
        const err = await res.json().catch(() => ({}));
        alert('Impossibile fornire: ' + (err.errore || res.status));
    }
}

async function restituisciMateriale(cmId, rmId) {
    const res = await apiFetch('/commessa-macchine/' + cmId + '/rich_mat/' + rmId + '/restituisci', 'POST', {});
    if (res && res.ok) {
        if (_commessaCorrente) caricaAlberoCommessa(_commessaCorrente);
    } else if (res) {
        const err = await res.json().catch(() => ({}));
        alert('Impossibile restituire: ' + (err.errore || res.status));
    }
}

document.getElementById('commessaPanelClose').addEventListener('click', chiudiVistaCommessa);
document.getElementById('commessaOverlay').addEventListener('click', function(e) {
    if (e.target === this) chiudiVistaCommessa();
});
