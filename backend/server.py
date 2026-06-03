import os, bcrypt
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity, get_jwt, verify_jwt_in_request
from functools import wraps
from flask_sqlalchemy import SQLAlchemy
from dotenv import load_dotenv
from datetime import timedelta

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('SQLALCHEMY_DATABASE_URI')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config["JWT_SECRET_KEY"] = os.getenv('JWT_SECRET_KEY')
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=10)

db = SQLAlchemy(app)
jwt = JWTManager(app)

_BASE = os.path.dirname(os.path.abspath(__file__))
MACHINE_IMG_DIR = os.path.join(_BASE, '..', 'Frontend', 'machineImg')
MACHINE_ST_DIR  = os.path.join(_BASE, '..', 'Frontend', 'machineST')


# ── MODELLI ──────────────────────────────────────────────────────────────────

class Cliente(db.Model):
    __tablename__ = 'clienti'
    id           = db.Column(db.Integer, primary_key=True)
    nome_cliente = db.Column(db.String(100), nullable=False)
    partita_iva  = db.Column(db.String(20))

class Commessa(db.Model):
    __tablename__ = 'commesse'
    id              = db.Column(db.Integer, primary_key=True)
    codice_commessa = db.Column(db.String(50))
    id_cliente      = db.Column(db.Integer, db.ForeignKey('clienti.id'), nullable=True)
    descrizione     = db.Column(db.String(255))
    anno            = db.Column(db.Integer)
    data_consegna   = db.Column(db.Date, nullable=True)
    stato_chiusura  = db.Column(db.Enum('APERTA', 'CHIUSA'), default='APERTA')

class Macchina(db.Model):
    __tablename__ = 'macchine'
    id          = db.Column(db.Integer, primary_key=True)
    codice      = db.Column(db.String(50))
    descrizione = db.Column(db.String(255))

class CommessaMacchina(db.Model):
    __tablename__ = 'commessa_macchine'
    id          = db.Column(db.Integer, primary_key=True)
    id_commessa = db.Column(db.Integer, db.ForeignKey('commesse.id'), nullable=False)
    id_macchina = db.Column(db.Integer, db.ForeignKey('macchine.id'), nullable=False)
    quantita    = db.Column(db.Integer, default=1)
    stato       = db.Column(db.Enum('IN_ATTESA', 'IN_CORSO', 'COMPLETATA'), default='IN_ATTESA')

class ProcessoTipo(db.Model):
    """Catalogo CONDIVISO dei tipi di processo (es. 'saldatura'), gestito dalla scheda Lavorazioni."""
    __tablename__ = 'processi_tipo'
    id          = db.Column(db.Integer, primary_key=True)
    descrizione = db.Column(db.String(255))

class Lavorazione(db.Model):
    """Istanza di un processo-tipo su una macchina, con sequenza via tav_padre.
    Se id_semilavorato è valorizzato, questa lavorazione rappresenta la produzione di un semilavorato."""
    __tablename__ = 'lavorazioni'
    id              = db.Column(db.Integer, primary_key=True)
    id_macchina     = db.Column(db.Integer, db.ForeignKey('macchine.id'), nullable=False)
    id_processo     = db.Column(db.Integer, db.ForeignKey('processi_tipo.id'), nullable=True)
    id_semilavorato = db.Column(db.Integer, db.ForeignKey('semilavorati.id'), nullable=True)
    tav_padre       = db.Column(db.Integer, db.ForeignKey('lavorazioni.id'), nullable=True)
    # Nessuno stato: l'avanzamento è derivato per commessa dalle forniture (vedi FornituraMateriale)

class Materiale(db.Model):
    __tablename__ = 'materialeMagazzino'
    id              = db.Column(db.Integer, primary_key=True)
    CodiceMateriale = db.Column(db.String(50))
    Descrizione     = db.Column(db.String(255))
    Quantita        = db.Column(db.Integer, default=0)

class RichMat(db.Model):
    """Materiale richiesto: sotto un processo (id_lavorazione) OPPURE diretto sulla macchina (id_macchina)."""
    __tablename__ = 'rich_mat'
    id             = db.Column(db.Integer, primary_key=True)
    id_lavorazione = db.Column(db.Integer, db.ForeignKey('lavorazioni.id'), nullable=True)
    id_macchina    = db.Column(db.Integer, db.ForeignKey('macchine.id'), nullable=True)
    id_materiale   = db.Column(db.Integer, db.ForeignKey('materialeMagazzino.id'), nullable=False)
    quantita       = db.Column(db.Float, nullable=False, default=1)

class FornituraMateriale(db.Model):
    """Unità di un materiale richiesto già prelevate dal magazzino per una macchina-in-commessa."""
    __tablename__ = 'fornitura_materiali'
    id                   = db.Column(db.Integer, primary_key=True)
    id_commessa_macchina = db.Column(db.Integer, db.ForeignKey('commessa_macchine.id'), nullable=False)
    id_rich_mat          = db.Column(db.Integer, db.ForeignKey('rich_mat.id'), nullable=False)
    quantita_fornita     = db.Column(db.Integer, nullable=False, default=0)

class Semilavorato(db.Model):
    """Prodotto interno = una lavorazione applicata a dei componenti. Nessuna giacenza propria."""
    __tablename__ = 'semilavorati'
    id          = db.Column(db.Integer, primary_key=True)
    codice      = db.Column(db.String(50))
    descrizione = db.Column(db.String(255))
    id_processo = db.Column(db.Integer, db.ForeignKey('processi_tipo.id'), nullable=True)

class SemilavoratoComponente(db.Model):
    """Riga di ricetta: un componente (materia prima O altro semilavorato) con quantità."""
    __tablename__ = 'semilavorato_componenti'
    id                   = db.Column(db.Integer, primary_key=True)
    id_semilavorato      = db.Column(db.Integer, db.ForeignKey('semilavorati.id'), nullable=False)
    id_materiale         = db.Column(db.Integer, db.ForeignKey('materialeMagazzino.id'), nullable=True)
    id_semilavorato_comp = db.Column(db.Integer, db.ForeignKey('semilavorati.id'), nullable=True)
    quantita             = db.Column(db.Float, nullable=False, default=1)

class Utente(db.Model):
    __tablename__ = 'utenti'
    id                   = db.Column(db.Integer, primary_key=True)
    identificatore_login = db.Column(db.String(50), nullable=False)
    password             = db.Column(db.String(255))
    nome                 = db.Column(db.String(50))
    cognome              = db.Column(db.String(50))
    ruolo                = db.Column(db.Enum('Admin', 'Dipendente', 'Terzista'), nullable=False)
    push_token           = db.Column(db.String(255))


# ── DECORATORI ───────────────────────────────────────────────────────────────

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        verify_jwt_in_request()
        if get_jwt().get("ruolo") != "admin":
            return jsonify({"errore": "Accesso negato: permessi insufficienti"}), 403
        return f(*args, **kwargs)
    return decorated


# ── HELPER ALBERO ─────────────────────────────────────────────────────────────

def desc_processo(lav):
    """Etichetta di una lavorazione-istanza: nome del semilavorato se la produce, altrimenti il processo-tipo."""
    if lav.id_semilavorato:
        s = Semilavorato.query.get(lav.id_semilavorato)
        if s:
            return s.descrizione or s.codice
    if lav.id_processo:
        p = ProcessoTipo.query.get(lav.id_processo)
        if p:
            return p.descrizione
    return None

def build_albero_lavorazione(id_lav, visitati):
    """Albero STRUTTURALE del catalogo (senza stato: lo stato è per commessa)."""
    if id_lav in visitati:
        return None
    visitati = visitati | {id_lav}
    lav = Lavorazione.query.get(id_lav)
    if not lav:
        return None

    materiali = []
    for r in RichMat.query.filter_by(id_lavorazione=id_lav).all():
        mat = Materiale.query.get(r.id_materiale)
        if mat:
            materiali.append({
                "id": r.id,
                "id_materiale": mat.id,
                "codice": mat.CodiceMateriale,
                "descrizione": mat.Descrizione,
                "quantita_richiesta": r.quantita,
                "quantita_stock": mat.Quantita,
                "tipo": "rich_mat"
            })

    figli = []
    for sub in Lavorazione.query.filter_by(tav_padre=id_lav).all():
        figlio = build_albero_lavorazione(sub.id, visitati)
        if figlio:
            figli.append(figlio)

    return {
        "id": lav.id,
        "descrizione": desc_processo(lav),
        "tipo": "lavorazione",
        "rich_mat": materiali,
        "figli": figli
    }


def serializza_richmat_diretti_catalogo(id_macchina):
    """Materiali attaccati direttamente alla macchina (senza processo) — vista catalogo."""
    out = []
    for r in RichMat.query.filter_by(id_macchina=id_macchina, id_lavorazione=None).all():
        mat = Materiale.query.get(r.id_materiale)
        if mat:
            out.append({
                "id": r.id, "id_materiale": mat.id,
                "codice": mat.CodiceMateriale, "descrizione": mat.Descrizione,
                "quantita_richiesta": r.quantita, "quantita_stock": mat.Quantita,
                "tipo": "rich_mat"
            })
    return out


def stato_lavorazione_cm(cm_id, cm_quantita, id_lav):
    """Stato DERIVATO di una lavorazione per una macchina-in-commessa, dalle forniture.
    Target di ogni materiale = quantita richiesta × n° macchine in commessa."""
    richs = RichMat.query.filter_by(id_lavorazione=id_lav).all()
    if not richs:
        return "COMPLETATA"  # nessun materiale da conferire: non blocca la sequenza
    completi = 0
    parziali = 0
    for r in richs:
        target = r.quantita * cm_quantita
        f = FornituraMateriale.query.filter_by(id_commessa_macchina=cm_id, id_rich_mat=r.id).first()
        forn = f.quantita_fornita if f else 0
        if forn >= target:
            completi += 1
        elif forn > 0:
            parziali += 1
    if completi == len(richs):
        return "COMPLETATA"
    if completi > 0 or parziali > 0:
        return "IN_CORSO"
    return "IN_ATTESA"


def build_albero_commessa(cm, id_lav, padre_completo, visitati):
    """Albero OPERATIVO per una macchina-in-commessa: stato derivato, forniture, lock sequenza."""
    if id_lav in visitati:
        return None
    visitati = visitati | {id_lav}
    lav = Lavorazione.query.get(id_lav)
    if not lav:
        return None

    stato = stato_lavorazione_cm(cm.id, cm.quantita, id_lav)

    materiali = []
    for r in RichMat.query.filter_by(id_lavorazione=id_lav).all():
        mat = Materiale.query.get(r.id_materiale)
        if not mat:
            continue
        f = FornituraMateriale.query.filter_by(id_commessa_macchina=cm.id, id_rich_mat=r.id).first()
        materiali.append({
            "rich_mat_id": r.id,
            "id_materiale": mat.id,
            "codice": mat.CodiceMateriale,
            "descrizione": mat.Descrizione,
            "quantita_richiesta": r.quantita,
            "target": r.quantita * cm.quantita,
            "quantita_fornita": f.quantita_fornita if f else 0,
            "quantita_stock": mat.Quantita,
            "tipo": "rich_mat"
        })

    figli = []
    completa = (stato == "COMPLETATA")
    for sub in Lavorazione.query.filter_by(tav_padre=id_lav).all():
        figlio = build_albero_commessa(cm, sub.id, completa, visitati)
        if figlio:
            figli.append(figlio)

    return {
        "id": lav.id,
        "descrizione": desc_processo(lav),
        "tipo": "lavorazione",
        "stato": stato,
        "bloccato": not padre_completo,   # sbloccato solo se il processo precedente è COMPLETATA
        "rich_mat": materiali,
        "figli": figli
    }


def serializza_richmat_diretti_commessa(cm):
    """Materiali diretti della macchina (senza processo) — vista operativa commessa."""
    out = []
    for r in RichMat.query.filter_by(id_macchina=cm.id_macchina, id_lavorazione=None).all():
        mat = Materiale.query.get(r.id_materiale)
        if not mat:
            continue
        f = FornituraMateriale.query.filter_by(id_commessa_macchina=cm.id, id_rich_mat=r.id).first()
        out.append({
            "rich_mat_id": r.id, "id_materiale": mat.id,
            "codice": mat.CodiceMateriale, "descrizione": mat.Descrizione,
            "quantita_richiesta": r.quantita, "target": r.quantita * cm.quantita,
            "quantita_fornita": f.quantita_fornita if f else 0,
            "quantita_stock": mat.Quantita, "tipo": "rich_mat"
        })
    return out


def progresso_commessa(id_commessa):
    """Percentuale di avanzamento: unità fornite / unità totali sui materiali foglia della commessa."""
    forn = 0.0
    tot = 0.0
    for cm in CommessaMacchina.query.filter_by(id_commessa=id_commessa).all():
        lav_ids = [l.id for l in Lavorazione.query.filter_by(id_macchina=cm.id_macchina).all()]
        richs = list(RichMat.query.filter_by(id_macchina=cm.id_macchina, id_lavorazione=None).all())
        if lav_ids:
            richs += RichMat.query.filter(RichMat.id_lavorazione.in_(lav_ids)).all()
        for r in richs:
            target = r.quantita * cm.quantita
            f = FornituraMateriale.query.filter_by(id_commessa_macchina=cm.id, id_rich_mat=r.id).first()
            forn += min(f.quantita_fornita if f else 0, target)
            tot += target
    return round(100 * forn / tot) if tot > 0 else 0


def espandi_semilavorato(id_sem, id_macchina, tav_padre, mult, visitati):
    """Istanzia la ricetta di un semilavorato come sotto-albero di lavorazioni+materiali sulla macchina.
    Ricorsivo (con anti-ciclo) per semilavorati annidati. Solo le materie prime foglia hanno stock."""
    if id_sem in visitati:
        return None
    visitati = visitati | {id_sem}
    s = Semilavorato.query.get(id_sem)
    if not s:
        return None
    lav = Lavorazione(id_macchina=id_macchina, id_processo=s.id_processo, id_semilavorato=s.id, tav_padre=tav_padre)
    db.session.add(lav)
    db.session.flush()  # serve lav.id
    for comp in SemilavoratoComponente.query.filter_by(id_semilavorato=id_sem).all():
        q = (comp.quantita or 1) * mult
        if comp.id_semilavorato_comp:
            espandi_semilavorato(comp.id_semilavorato_comp, id_macchina, lav.id, q, visitati)
        elif comp.id_materiale:
            db.session.add(RichMat(id_lavorazione=lav.id, id_materiale=comp.id_materiale, quantita=q))
    return lav


# ── HOME ──────────────────────────────────────────────────────────────────────

@app.route("/", methods=["GET"])
def home():
    return jsonify({"stato": "Server attivo e funzionante!"}), 200


# ── LOGIN ─────────────────────────────────────────────────────────────────────

@app.route("/login", methods=["POST"])
def login():
    data = request.get_json()
    if not data:
        return jsonify({"errore": "Dati mancanti"}), 400

    username = data.get("username")
    password = data.get("password")

    env_username      = os.getenv('ADMIN_USR')
    env_password_hash = os.getenv('ADMIN_PASSWD')

    if username == env_username and bcrypt.checkpw(password.encode(), env_password_hash.encode()):
        token = create_access_token(identity=username, additional_claims={"ruolo": "admin"})
        return jsonify({"token": token}), 200

    utente = Utente.query.filter_by(identificatore_login=username, ruolo='Dipendente').first()
    if utente and utente.password and bcrypt.checkpw(password.encode(), utente.password.encode()):
        token = create_access_token(
            identity=username,
            additional_claims={"ruolo": "dipendente", "nome": utente.nome or "", "cognome": utente.cognome or ""}
        )
        return jsonify({"token": token}), 200

    return jsonify({"errore": "Credenziali Errate"}), 401


# ── CLIENTI ───────────────────────────────────────────────────────────────────

@app.route("/clienti", methods=["GET"])
@jwt_required()
def get_clienti():
    return jsonify([{
        "id": c.id, "nome_cliente": c.nome_cliente, "partita_iva": c.partita_iva or ""
    } for c in Cliente.query.all()])

@app.route("/clienti", methods=["POST"])
@jwt_required()
def crea_cliente():
    data = request.get_json()
    if not data or not data.get("nome_cliente"):
        return jsonify({"errore": "nome_cliente obbligatorio"}), 400
    nuovo = Cliente(nome_cliente=data["nome_cliente"], partita_iva=data.get("partita_iva"))
    db.session.add(nuovo)
    db.session.commit()
    return jsonify({"messaggio": "Cliente creato", "id": nuovo.id}), 201

@app.route("/clienti/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_cliente(id):
    cliente = Cliente.query.get(id)
    if not cliente:
        return jsonify({"errore": "Cliente non trovato"}), 404
    data = request.get_json() or {}
    cliente.nome_cliente = data.get("nome_cliente", cliente.nome_cliente)
    cliente.partita_iva  = data.get("partita_iva", cliente.partita_iva)
    db.session.commit()
    return jsonify({"messaggio": "Cliente aggiornato"}), 200

@app.route("/clienti/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_cliente(id):
    cliente = Cliente.query.get(id)
    if not cliente:
        return jsonify({"errore": "Cliente non trovato"}), 404
    db.session.delete(cliente)
    db.session.commit()
    return jsonify({"messaggio": "Cliente eliminato"}), 200


# ── COMMESSE ──────────────────────────────────────────────────────────────────

@app.route("/commesse", methods=["GET"])
@jwt_required()
def get_commesse():
    return jsonify([{
        "id": c.id,
        "codice": c.codice_commessa,
        "id_cliente": c.id_cliente,
        "descrizione": c.descrizione,
        "anno": c.anno,
        "data_consegna": c.data_consegna.isoformat() if c.data_consegna else None,
        "stato": c.stato_chiusura,
        "progresso": progresso_commessa(c.id)
    } for c in Commessa.query.all()])

@app.route("/commesse", methods=["POST"])
@jwt_required()
def crea_commessa():
    data = request.get_json()
    if not data:
        return jsonify({"errore": "Dati mancanti"}), 400
    nuova = Commessa(
        codice_commessa=data.get("codice_commessa"),
        id_cliente=data.get("id_cliente"),
        descrizione=data.get("descrizione"),
        anno=data.get("anno"),
        data_consegna=data.get("data_consegna"),
        stato_chiusura=data.get("stato_chiusura", "APERTA")
    )
    db.session.add(nuova)
    db.session.commit()
    return jsonify({"messaggio": "Commessa creata", "id": nuova.id}), 201

@app.route("/commesse/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_commessa(id):
    commessa = Commessa.query.get(id)
    if not commessa:
        return jsonify({"errore": "Commessa non trovata"}), 404
    data = request.get_json() or {}
    commessa.codice_commessa = data.get("codice_commessa", commessa.codice_commessa)
    commessa.id_cliente      = data.get("id_cliente", commessa.id_cliente)
    commessa.descrizione     = data.get("descrizione", commessa.descrizione)
    commessa.anno            = data.get("anno", commessa.anno)
    commessa.data_consegna   = data.get("data_consegna", commessa.data_consegna)
    commessa.stato_chiusura  = data.get("stato_chiusura", commessa.stato_chiusura)
    db.session.commit()
    return jsonify({"messaggio": "Commessa aggiornata"}), 200

@app.route("/commesse/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_commessa(id):
    commessa = Commessa.query.get(id)
    if not commessa:
        return jsonify({"errore": "Commessa non trovata"}), 404
    db.session.delete(commessa)
    db.session.commit()
    return jsonify({"messaggio": "Commessa eliminata"}), 200

@app.route("/commesse/<int:id>/macchine", methods=["GET"])
@jwt_required()
def get_macchine_commessa(id):
    entries = CommessaMacchina.query.filter_by(id_commessa=id).all()
    result = []
    for e in entries:
        m = Macchina.query.get(e.id_macchina)
        if m:
            result.append({
                "id": m.id, "link_id": e.id,
                "codice": m.codice, "descrizione": m.descrizione,
                "quantita": e.quantita, "stato": e.stato
            })
    return jsonify(result), 200

@app.route("/commesse/<int:id>/macchine", methods=["POST"])
@jwt_required()
def aggiungi_macchina_commessa(id):
    data = request.get_json()
    if not data or not data.get("id_macchina"):
        return jsonify({"errore": "id_macchina obbligatorio"}), 400
    nuova = CommessaMacchina(
        id_commessa=id,
        id_macchina=data["id_macchina"],
        quantita=data.get("quantita", 1),
        stato=data.get("stato", "IN_ATTESA")
    )
    db.session.add(nuova)
    db.session.commit()
    return jsonify({"messaggio": "Macchina aggiunta alla commessa", "id": nuova.id}), 201

@app.route("/commesse/<int:id>/macchine/<int:link_id>", methods=["DELETE"])
@jwt_required()
def rimuovi_macchina_commessa(id, link_id):
    entry = CommessaMacchina.query.filter_by(id=link_id, id_commessa=id).first()
    if not entry:
        return jsonify({"errore": "Associazione non trovata"}), 404
    db.session.delete(entry)
    db.session.commit()
    return jsonify({"messaggio": "Macchina rimossa dalla commessa"}), 200

@app.route("/commesse/<int:id>/albero", methods=["GET"])
@jwt_required()
def get_albero_commessa(id):
    """Albero operativo della commessa: commessa → macchine → processi/materiali,
    con stato derivato per processo, quantità fornite e lock di sequenza."""
    commessa = Commessa.query.get(id)
    if not commessa:
        return jsonify({"errore": "Commessa non trovata"}), 404

    macchine = []
    for cm in CommessaMacchina.query.filter_by(id_commessa=id).all():
        m = Macchina.query.get(cm.id_macchina)
        if not m:
            continue
        root_lavs = Lavorazione.query.filter_by(id_macchina=cm.id_macchina, tav_padre=None).all()
        lavs = []
        for lav in root_lavs:
            albero = build_albero_commessa(cm, lav.id, True, set())
            if albero:
                lavs.append(albero)
        macchine.append({
            "commessa_macchina_id": cm.id,
            "id": m.id, "codice": m.codice, "descrizione": m.descrizione,
            "quantita": cm.quantita, "tipo": "macchina",
            "lavorazioni": lavs,
            "materiali_diretti": serializza_richmat_diretti_commessa(cm)
        })

    return jsonify({
        "id": commessa.id, "codice": commessa.codice_commessa,
        "descrizione": commessa.descrizione, "tipo": "commessa",
        "macchine": macchine
    }), 200


# ── FORNITURA MATERIALI (drag&drop operativo: scarico magazzino per commessa) ──

def _valida_fornitura(cm_id, rm_id):
    """Valida la coppia commessa-macchina / materiale richiesto.
    Il materiale può stare sotto un processo (lav) o essere diretto sulla macchina (lav=None)."""
    cm = CommessaMacchina.query.get(cm_id)
    rm = RichMat.query.get(rm_id)
    if not cm or not rm:
        return None, None, None, (jsonify({"errore": "Commessa-macchina o materiale non trovato"}), 404)
    lav = Lavorazione.query.get(rm.id_lavorazione) if rm.id_lavorazione else None
    macchina_del_mat = lav.id_macchina if lav else rm.id_macchina
    if macchina_del_mat != cm.id_macchina:
        return None, None, None, (jsonify({"errore": "Il materiale non appartiene a questa macchina"}), 400)
    return cm, rm, lav, None

@app.route("/commessa-macchine/<int:cm_id>/rich_mat/<int:rm_id>/fornisci", methods=["POST"])
@jwt_required()
def fornisci_materiale(cm_id, rm_id):
    """Trascina 1 unità nel processo: scala il magazzino e avanza la fornitura."""
    cm, rm, lav, err = _valida_fornitura(cm_id, rm_id)
    if err:
        return err

    # Vincolo di sequenza: il processo precedente (tav_padre) dev'essere completato
    if lav and lav.tav_padre and stato_lavorazione_cm(cm.id, cm.quantita, lav.tav_padre) != "COMPLETATA":
        return jsonify({"errore": "Il processo precedente non è ancora completato"}), 409

    target = rm.quantita * cm.quantita
    f = FornituraMateriale.query.filter_by(id_commessa_macchina=cm.id, id_rich_mat=rm.id).first()
    forn = f.quantita_fornita if f else 0
    if forn >= target:
        return jsonify({"errore": "Materiale già completo"}), 409

    mat = Materiale.query.get(rm.id_materiale)
    if not mat or (mat.Quantita or 0) < 1:
        return jsonify({"errore": "Stock insufficiente in magazzino"}), 409

    mat.Quantita -= 1
    if not f:
        f = FornituraMateriale(id_commessa_macchina=cm.id, id_rich_mat=rm.id, quantita_fornita=0)
        db.session.add(f)
    f.quantita_fornita += 1
    db.session.commit()

    return jsonify({
        "messaggio": "Materiale fornito",
        "quantita_fornita": f.quantita_fornita,
        "target": target,
        "quantita_stock": mat.Quantita,
        "stato_lavorazione": stato_lavorazione_cm(cm.id, cm.quantita, lav.id) if lav else None
    }), 200

@app.route("/commessa-macchine/<int:cm_id>/rich_mat/<int:rm_id>/restituisci", methods=["POST"])
@jwt_required()
def restituisci_materiale(cm_id, rm_id):
    """Annulla 1 unità: rimette il pezzo in magazzino."""
    cm, rm, lav, err = _valida_fornitura(cm_id, rm_id)
    if err:
        return err

    f = FornituraMateriale.query.filter_by(id_commessa_macchina=cm.id, id_rich_mat=rm.id).first()
    if not f or f.quantita_fornita <= 0:
        return jsonify({"errore": "Niente da restituire"}), 409

    mat = Materiale.query.get(rm.id_materiale)
    f.quantita_fornita -= 1
    if mat:
        mat.Quantita = (mat.Quantita or 0) + 1
    db.session.commit()

    return jsonify({
        "messaggio": "Materiale restituito",
        "quantita_fornita": f.quantita_fornita,
        "target": rm.quantita * cm.quantita,
        "quantita_stock": mat.Quantita if mat else None,
        "stato_lavorazione": stato_lavorazione_cm(cm.id, cm.quantita, lav.id) if lav else None
    }), 200


# ── MACCHINE ──────────────────────────────────────────────────────────────────

@app.route("/macchine", methods=["GET"])
@jwt_required()
def get_macchine():
    return jsonify([{
        "id": m.id, "codice": m.codice, "descrizione": m.descrizione
    } for m in Macchina.query.all()])

@app.route("/macchine", methods=["POST"])
@jwt_required()
def aggiungi_macchina():
    data = request.get_json()
    if not data:
        return jsonify({"errore": "Dati mancanti"}), 400
    nuova = Macchina(
        codice=data.get("codice"),
        descrizione=data.get("descrizione")
    )
    db.session.add(nuova)
    db.session.commit()
    return jsonify({"messaggio": "Macchina aggiunta al catalogo", "id": nuova.id}), 201

@app.route("/macchine/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_macchina(id):
    macchina = Macchina.query.get(id)
    if not macchina:
        return jsonify({"errore": "Macchina non trovata"}), 404
    data = request.get_json() or {}
    macchina.codice      = data.get("codice", macchina.codice)
    macchina.descrizione = data.get("descrizione", macchina.descrizione)
    db.session.commit()
    return jsonify({"messaggio": "Macchina aggiornata"}), 200

@app.route("/macchine/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_macchina(id):
    macchina = Macchina.query.get(id)
    if not macchina:
        return jsonify({"errore": "Macchina non trovata"}), 404
    db.session.delete(macchina)
    db.session.commit()
    return jsonify({"messaggio": "Macchina eliminata"}), 200

@app.route("/macchine/<int:id>/lavorazioni", methods=["GET"])
@jwt_required()
def get_lavorazioni_macchina(id):
    lavorazioni = Lavorazione.query.filter_by(id_macchina=id).all()
    return jsonify([{
        "id": l.id, "descrizione": desc_processo(l),
        "id_processo": l.id_processo, "tav_padre": l.tav_padre
    } for l in lavorazioni]), 200

@app.route("/macchine/<int:id>/albero", methods=["GET"])
@jwt_required()
def get_albero_macchina(id):
    macchina = Macchina.query.get(id)
    if not macchina:
        return jsonify({"errore": "Macchina non trovata"}), 404

    root_lavs = Lavorazione.query.filter_by(id_macchina=id, tav_padre=None).all()
    lavorazioni = []
    for lav in root_lavs:
        albero = build_albero_lavorazione(lav.id, set())
        if albero:
            lavorazioni.append(albero)

    return jsonify({
        "id": macchina.id, "codice": macchina.codice,
        "descrizione": macchina.descrizione, "tipo": "macchina",
        "lavorazioni": lavorazioni,
        "materiali_diretti": serializza_richmat_diretti_catalogo(id)
    }), 200

@app.route("/macchine/<int:id>/files", methods=["GET"])
@jwt_required()
def get_files_macchina(id):
    macchina = Macchina.query.get(id)
    if not macchina:
        return jsonify({"errore": "Macchina non trovata"}), 404
    codice = macchina.codice
    immagine = None
    for ext in ['jpg', 'jpeg', 'png', 'webp']:
        if os.path.exists(os.path.join(MACHINE_IMG_DIR, f"{codice}.{ext}")):
            immagine = f"{codice}.{ext}"
            break
    schede = []
    if os.path.isdir(MACHINE_ST_DIR):
        for f in sorted(os.listdir(MACHINE_ST_DIR)):
            if f.lower().endswith('.pdf') and (f.startswith(codice + '_') or f == codice + '.pdf'):
                schede.append(f)
    return jsonify({"immagine": immagine, "schede": schede}), 200

@app.route("/macchine/img/<filename>", methods=["GET"])
@jwt_required()
def serve_machine_img(filename):
    filepath = os.path.join(MACHINE_IMG_DIR, filename)
    if not os.path.isfile(filepath):
        return jsonify({"errore": "File non trovato"}), 404
    return send_file(filepath)

@app.route("/macchine/st/<filename>", methods=["GET"])
@jwt_required()
def serve_machine_st(filename):
    filepath = os.path.join(MACHINE_ST_DIR, filename)
    if not os.path.isfile(filepath):
        return jsonify({"errore": "File non trovato"}), 404
    return send_file(filepath, mimetype='application/pdf')


# ── PROCESSI (catalogo condiviso, scheda "Lavorazioni") ───────────────────────

@app.route("/processi", methods=["GET"])
@jwt_required()
def get_processi():
    return jsonify([{
        "id": p.id, "descrizione": p.descrizione
    } for p in ProcessoTipo.query.all()])

@app.route("/processi", methods=["POST"])
@jwt_required()
def crea_processo():
    data = request.get_json()
    if not data or not data.get("descrizione"):
        return jsonify({"errore": "descrizione obbligatoria"}), 400
    nuovo = ProcessoTipo(descrizione=data["descrizione"])
    db.session.add(nuovo)
    db.session.commit()
    return jsonify({"messaggio": "Processo creato", "id": nuovo.id}), 201

@app.route("/processi/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_processo(id):
    p = ProcessoTipo.query.get(id)
    if not p:
        return jsonify({"errore": "Processo non trovato"}), 404
    data = request.get_json() or {}
    p.descrizione = data.get("descrizione", p.descrizione)
    db.session.commit()
    return jsonify({"messaggio": "Processo aggiornato"}), 200

@app.route("/processi/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_processo(id):
    p = ProcessoTipo.query.get(id)
    if not p:
        return jsonify({"errore": "Processo non trovato"}), 404
    usi = Lavorazione.query.filter_by(id_processo=id).count()
    if usi:
        return jsonify({"errore": "Processo usato da %d macchina/e: rimuovilo prima da quelle." % usi}), 409
    db.session.delete(p)
    db.session.commit()
    return jsonify({"messaggio": "Processo eliminato"}), 200


# ── SEMILAVORATI (catalogo: lavorazione + componenti) ─────────────────────────

@app.route("/semilavorati", methods=["GET"])
@jwt_required()
def get_semilavorati():
    out = []
    for s in Semilavorato.query.all():
        p = ProcessoTipo.query.get(s.id_processo) if s.id_processo else None
        out.append({
            "id": s.id, "codice": s.codice, "descrizione": s.descrizione,
            "id_processo": s.id_processo, "processo": p.descrizione if p else None
        })
    return jsonify(out)

@app.route("/semilavorati", methods=["POST"])
@jwt_required()
def crea_semilavorato():
    data = request.get_json()
    if not data or not data.get("descrizione"):
        return jsonify({"errore": "descrizione obbligatoria"}), 400
    nuovo = Semilavorato(codice=data.get("codice"), descrizione=data.get("descrizione"), id_processo=data.get("id_processo") or None)
    db.session.add(nuovo)
    db.session.commit()
    return jsonify({"messaggio": "Semilavorato creato", "id": nuovo.id}), 201

@app.route("/semilavorati/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_semilavorato(id):
    s = Semilavorato.query.get(id)
    if not s:
        return jsonify({"errore": "Semilavorato non trovato"}), 404
    data = request.get_json() or {}
    s.codice      = data.get("codice", s.codice)
    s.descrizione = data.get("descrizione", s.descrizione)
    if "id_processo" in data:
        s.id_processo = data.get("id_processo") or None
    db.session.commit()
    return jsonify({"messaggio": "Semilavorato aggiornato"}), 200

@app.route("/semilavorati/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_semilavorato(id):
    s = Semilavorato.query.get(id)
    if not s:
        return jsonify({"errore": "Semilavorato non trovato"}), 404
    usi_lav = Lavorazione.query.filter_by(id_semilavorato=id).count()
    usi_comp = SemilavoratoComponente.query.filter_by(id_semilavorato_comp=id).count()
    if usi_lav or usi_comp:
        return jsonify({"errore": "Semilavorato in uso (in macchine o in altre ricette): rimuovilo prima da lì."}), 409
    SemilavoratoComponente.query.filter_by(id_semilavorato=id).delete()
    db.session.delete(s)
    db.session.commit()
    return jsonify({"messaggio": "Semilavorato eliminato"}), 200

@app.route("/semilavorati/<int:id>/componenti", methods=["GET"])
@jwt_required()
def get_componenti_semilavorato(id):
    out = []
    for comp in SemilavoratoComponente.query.filter_by(id_semilavorato=id).all():
        if comp.id_semilavorato_comp:
            sc = Semilavorato.query.get(comp.id_semilavorato_comp)
            out.append({"id": comp.id, "tipo": "semilavorato", "rif_id": comp.id_semilavorato_comp,
                        "codice": sc.codice if sc else None, "descrizione": sc.descrizione if sc else None,
                        "quantita": comp.quantita})
        else:
            mat = Materiale.query.get(comp.id_materiale)
            out.append({"id": comp.id, "tipo": "materiale", "rif_id": comp.id_materiale,
                        "codice": mat.CodiceMateriale if mat else None, "descrizione": mat.Descrizione if mat else None,
                        "quantita": comp.quantita})
    return jsonify(out), 200

@app.route("/semilavorati/<int:id>/componenti", methods=["POST"])
@jwt_required()
def aggiungi_componente_semilavorato(id):
    if not Semilavorato.query.get(id):
        return jsonify({"errore": "Semilavorato non trovato"}), 404
    data = request.get_json() or {}
    qty = float(data.get("quantita", 1))
    if qty <= 0:
        return jsonify({"errore": "Quantità deve essere maggiore di zero"}), 400
    id_mat = data.get("id_materiale")
    id_sem = data.get("id_semilavorato_comp")
    if not id_mat and not id_sem:
        return jsonify({"errore": "Specifica un materiale o un semilavorato"}), 400
    if id_sem and int(id_sem) == id:
        return jsonify({"errore": "Un semilavorato non può contenere se stesso"}), 400
    comp = SemilavoratoComponente(id_semilavorato=id, id_materiale=id_mat or None,
                                  id_semilavorato_comp=id_sem or None, quantita=qty)
    db.session.add(comp)
    db.session.commit()
    return jsonify({"messaggio": "Componente aggiunto", "id": comp.id}), 201

@app.route("/semilavorato_componenti/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_componente_semilavorato(id):
    comp = SemilavoratoComponente.query.get(id)
    if not comp:
        return jsonify({"errore": "Componente non trovato"}), 404
    db.session.delete(comp)
    db.session.commit()
    return jsonify({"messaggio": "Componente rimosso"}), 200

@app.route("/lavorazioni/<int:id>/semilavorato", methods=["POST"])
@jwt_required()
def aggiungi_semilavorato_lavorazione(id):
    """Aggiunge (espandendo) un semilavorato come sotto-processo di una lavorazione."""
    lav = Lavorazione.query.get(id)
    if not lav:
        return jsonify({"errore": "Lavorazione non trovata"}), 404
    data = request.get_json() or {}
    if not data.get("id_semilavorato"):
        return jsonify({"errore": "id_semilavorato obbligatorio"}), 400
    qty = float(data.get("quantita", 1))
    espandi_semilavorato(data["id_semilavorato"], lav.id_macchina, lav.id, qty, set())
    db.session.commit()
    return jsonify({"messaggio": "Semilavorato aggiunto"}), 201

@app.route("/macchine/<int:id>/semilavorato", methods=["POST"])
@jwt_required()
def aggiungi_semilavorato_macchina(id):
    """Aggiunge (espandendo) un semilavorato direttamente sulla macchina (processo radice)."""
    if not Macchina.query.get(id):
        return jsonify({"errore": "Macchina non trovata"}), 404
    data = request.get_json() or {}
    if not data.get("id_semilavorato"):
        return jsonify({"errore": "id_semilavorato obbligatorio"}), 400
    qty = float(data.get("quantita", 1))
    espandi_semilavorato(data["id_semilavorato"], id, None, qty, set())
    db.session.commit()
    return jsonify({"messaggio": "Semilavorato aggiunto"}), 201


# ── LAVORAZIONI (istanze di processo su macchina) ─────────────────────────────

@app.route("/lavorazioni", methods=["GET"])
@jwt_required()
def get_lavorazioni():
    return jsonify([{
        "id": l.id, "descrizione": desc_processo(l),
        "id_processo": l.id_processo,
        "id_macchina": l.id_macchina, "tav_padre": l.tav_padre
    } for l in Lavorazione.query.all()])

@app.route("/lavorazioni", methods=["POST"])
@jwt_required()
def crea_lavorazione():
    data = request.get_json()
    if not data or not data.get("id_macchina"):
        return jsonify({"errore": "id_macchina obbligatorio"}), 400
    if not data.get("id_processo"):
        return jsonify({"errore": "id_processo obbligatorio"}), 400

    tav_padre = data.get("tav_padre") or None
    if tav_padre:
        padre = Lavorazione.query.get(tav_padre)
        if not padre or padre.id_macchina != int(data.get("id_macchina")):
            return jsonify({"errore": "tav_padre non valido o appartiene ad altra macchina"}), 400

    nuova = Lavorazione(
        id_macchina=data.get("id_macchina"),
        id_processo=data.get("id_processo"),
        tav_padre=tav_padre
    )
    db.session.add(nuova)
    db.session.commit()
    return jsonify({"messaggio": "Lavorazione creata", "id": nuova.id}), 201

@app.route("/lavorazioni/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_lavorazione(id):
    lavorazione = Lavorazione.query.get(id)
    if not lavorazione:
        return jsonify({"errore": "Lavorazione non trovata"}), 404
    data = request.get_json() or {}
    lavorazione.id_processo = data.get("id_processo", lavorazione.id_processo)
    lavorazione.tav_padre   = data.get("tav_padre", lavorazione.tav_padre) or None
    db.session.commit()
    return jsonify({"messaggio": "Lavorazione aggiornata"}), 200

def _elimina_lavorazione_ricorsiva(id_lav):
    """Elimina una lavorazione, i suoi sotto-processi e i materiali richiesti.
    Le forniture si cancellano in cascade sul DELETE delle rich_mat (FK ON DELETE CASCADE)."""
    for sub in Lavorazione.query.filter_by(tav_padre=id_lav).all():
        _elimina_lavorazione_ricorsiva(sub.id)
    RichMat.query.filter_by(id_lavorazione=id_lav).delete()
    Lavorazione.query.filter_by(id=id_lav).delete()

@app.route("/lavorazioni/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_lavorazione(id):
    lavorazione = Lavorazione.query.get(id)
    if not lavorazione:
        return jsonify({"errore": "Lavorazione non trovata"}), 404
    _elimina_lavorazione_ricorsiva(id)
    db.session.commit()
    return jsonify({"messaggio": "Lavorazione eliminata"}), 200

@app.route("/lavorazioni/<int:id>/rich_mat", methods=["GET"])
@jwt_required()
def get_rich_mat_lavorazione(id):
    risultati = []
    for r in RichMat.query.filter_by(id_lavorazione=id).all():
        mat = Materiale.query.get(r.id_materiale)
        if mat:
            risultati.append({
                "id": r.id,
                "id_materiale": mat.id,
                "codice": mat.CodiceMateriale,
                "descrizione": mat.Descrizione,
                "quantita_richiesta": r.quantita,
                "quantita_stock": mat.Quantita
            })
    return jsonify(risultati), 200

@app.route("/lavorazioni/<int:id>/rich_mat", methods=["POST"])
@jwt_required()
def aggiungi_rich_mat(id):
    data = request.get_json()
    if not data or not data.get("id_materiale"):
        return jsonify({"errore": "id_materiale obbligatorio"}), 400
    qty = float(data.get("quantita", 1))
    if qty <= 0:
        return jsonify({"errore": "Quantità deve essere maggiore di zero"}), 400
    nuovo = RichMat(
        id_lavorazione=id,
        id_materiale=data.get("id_materiale"),
        quantita=qty
    )
    db.session.add(nuovo)
    db.session.commit()
    return jsonify({"messaggio": "Materiale aggiunto", "id": nuovo.id}), 201

@app.route("/macchine/<int:id>/rich_mat", methods=["POST"])
@jwt_required()
def aggiungi_rich_mat_macchina(id):
    """Materiale richiesto DIRETTO sulla macchina (senza processo, montato as-is)."""
    if not Macchina.query.get(id):
        return jsonify({"errore": "Macchina non trovata"}), 404
    data = request.get_json()
    if not data or not data.get("id_materiale"):
        return jsonify({"errore": "id_materiale obbligatorio"}), 400
    qty = float(data.get("quantita", 1))
    if qty <= 0:
        return jsonify({"errore": "Quantità deve essere maggiore di zero"}), 400
    nuovo = RichMat(
        id_macchina=id,
        id_materiale=data.get("id_materiale"),
        quantita=qty
    )
    db.session.add(nuovo)
    db.session.commit()
    return jsonify({"messaggio": "Materiale diretto aggiunto", "id": nuovo.id}), 201


# ── RICH MAT (singolo) ────────────────────────────────────────────────────────

@app.route("/rich_mat/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_rich_mat(id):
    r = RichMat.query.get(id)
    if not r:
        return jsonify({"errore": "Richiesta non trovata"}), 404
    data = request.get_json() or {}
    qty = data.get("quantita", r.quantita)
    if qty is not None and float(qty) <= 0:
        return jsonify({"errore": "Quantità deve essere maggiore di zero"}), 400
    r.id_materiale = data.get("id_materiale", r.id_materiale)
    r.quantita     = qty
    db.session.commit()
    return jsonify({"messaggio": "Richiesta aggiornata"}), 200

@app.route("/rich_mat/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_rich_mat(id):
    r = RichMat.query.get(id)
    if not r:
        return jsonify({"errore": "Richiesta non trovata"}), 404
    db.session.delete(r)
    db.session.commit()
    return jsonify({"messaggio": "Richiesta eliminata"}), 200


# ── MATERIALE (catalogo) ──────────────────────────────────────────────────────

@app.route("/materiale", methods=["GET"])
@jwt_required()
def get_materiale():
    return jsonify([{
        "id": m.id, "codice": m.CodiceMateriale,
        "descrizione": m.Descrizione, "quantita": m.Quantita
    } for m in Materiale.query.all()])

@app.route("/materiale", methods=["POST"])
@jwt_required()
def aggiungi_materiale():
    data = request.get_json()
    if not data:
        return jsonify({"errore": "Dati mancanti"}), 400
    qty = data.get("quantita", 0)
    if qty is not None and float(qty) < 0:
        return jsonify({"errore": "La quantità non può essere negativa"}), 400
    nuovo = Materiale(
        CodiceMateriale=data.get("codice"),
        Descrizione=data.get("descrizione"),
        Quantita=qty
    )
    db.session.add(nuovo)
    db.session.commit()
    return jsonify({"messaggio": "Materiale aggiunto", "id": nuovo.id}), 201

@app.route("/materiale/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_materiale(id):
    mat = Materiale.query.get(id)
    if not mat:
        return jsonify({"errore": "Materiale non trovato"}), 404
    data = request.get_json() or {}
    qty = data.get("quantita", mat.Quantita)
    if qty is not None and float(qty) < 0:
        return jsonify({"errore": "La quantità non può essere negativa"}), 400
    mat.CodiceMateriale = data.get("codice", mat.CodiceMateriale)
    mat.Descrizione     = data.get("descrizione", mat.Descrizione)
    mat.Quantita        = qty
    db.session.commit()
    return jsonify({"messaggio": "Materiale aggiornato"}), 200

@app.route("/materiale/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_materiale(id):
    mat = Materiale.query.get(id)
    if not mat:
        return jsonify({"errore": "Materiale non trovato"}), 404
    db.session.delete(mat)
    db.session.commit()
    return jsonify({"messaggio": "Materiale eliminato"}), 200


# ── LOGININFO ─────────────────────────────────────────────────────────────────

@app.route("/logininfo", methods=["GET"])
@jwt_required()
def get_current_user():
    claims = get_jwt()
    return jsonify({
        "username": get_jwt_identity(),
        "ruolo": claims.get("ruolo", ""),
        "nome": claims.get("nome", "")
    }), 200


# ── UTENTI (solo admin) ───────────────────────────────────────────────────────

@app.route("/utenti", methods=["GET"])
@admin_required
def get_utenti():
    return jsonify([{
        "id": u.id, "identificatore_login": u.identificatore_login,
        "nome": u.nome or "", "cognome": u.cognome or "", "ruolo": u.ruolo
    } for u in Utente.query.filter_by(ruolo='Dipendente').all()]), 200

@app.route("/utenti", methods=["POST"])
@admin_required
def crea_utente():
    data = request.get_json()
    if not data:
        return jsonify({"errore": "Dati mancanti"}), 400
    identificatore = data.get("identificatore_login", "").strip()
    password = data.get("password", "")
    if not identificatore or not password:
        return jsonify({"errore": "identificatore_login e password sono obbligatori"}), 400
    if Utente.query.filter_by(identificatore_login=identificatore).first():
        return jsonify({"errore": "Identificatore già in uso"}), 409
    nuovo = Utente(
        identificatore_login=identificatore,
        password=bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode(),
        nome=data.get("nome", "").strip(),
        cognome=data.get("cognome", "").strip(),
        ruolo='Dipendente'
    )
    db.session.add(nuovo)
    db.session.commit()
    return jsonify({"messaggio": "Utente creato", "id": nuovo.id}), 201

@app.route("/utenti/<int:id>/password", methods=["PUT"])
@admin_required
def cambia_password_utente(id):
    utente = Utente.query.get(id)
    if not utente:
        return jsonify({"errore": "Utente non trovato"}), 404
    data = request.get_json()
    nuova = data.get("password", "")
    if not nuova:
        return jsonify({"errore": "Password mancante"}), 400
    utente.password = bcrypt.hashpw(nuova.encode(), bcrypt.gensalt(rounds=12)).decode()
    db.session.commit()
    return jsonify({"messaggio": "Password aggiornata"}), 200

@app.route("/utenti/<int:id>", methods=["DELETE"])
@admin_required
def elimina_utente(id):
    utente = Utente.query.get(id)
    if not utente:
        return jsonify({"errore": "Utente non trovato"}), 404
    db.session.delete(utente)
    db.session.commit()
    return jsonify({"messaggio": "Utente eliminato"}), 200


# ── AVVIO ─────────────────────────────────────────────────────────────────────

with app.app_context():
    db.create_all()
    print("[DB] Database pronto.")

if __name__ == "__main__":
    app.run(port=5001, debug=True)
