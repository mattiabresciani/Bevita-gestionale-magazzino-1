import os, bcrypt
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity, get_jwt, verify_jwt_in_request
from functools import wraps
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
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


# ── ACCESSO AL DB CON SQL ESPLICITO ───────────────────────────────────────────
# Le query sono scritte in chiaro (SQL) ed eseguite con parametri legati (:nome),
# evitando le scorciatoie ORM. I parametri sono sempre passati separatamente per
# prevenire SQL injection.

def q_all(sql, **params):
    """Esegue una SELECT e restituisce tutte le righe come lista di dizionari."""
    return [dict(r) for r in db.session.execute(text(sql), params).mappings().all()]

def q_one(sql, **params):
    """Esegue una SELECT e restituisce la prima riga come dizionario (o None)."""
    row = db.session.execute(text(sql), params).mappings().first()
    return dict(row) if row else None

def q_scalar(sql, **params):
    """Esegue una SELECT che ritorna un singolo valore (es. COUNT)."""
    return db.session.execute(text(sql), params).scalar()

def q_exec(sql, commit=True, **params):
    """Esegue INSERT/UPDATE/DELETE. Ritorna il result (per lastrowid/rowcount)."""
    res = db.session.execute(text(sql), params)
    if commit:
        db.session.commit()
    return res


# ── MODELLI (solo per la creazione dello schema con db.create_all) ────────────

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
    """Etichetta di una lavorazione-istanza: nome del semilavorato se la produce, altrimenti il processo-tipo.
    `lav` è un dizionario con almeno le chiavi id_semilavorato e id_processo."""
    if lav.get("id_semilavorato"):
        s = q_one("SELECT codice, descrizione FROM semilavorati WHERE id = :id", id=lav["id_semilavorato"])
        if s:
            return s["descrizione"] or s["codice"]
    if lav.get("id_processo"):
        p = q_one("SELECT descrizione FROM processi_tipo WHERE id = :id", id=lav["id_processo"])
        if p:
            return p["descrizione"]
    return None

def build_albero_lavorazione(id_lav, visitati):
    """Albero STRUTTURALE del catalogo (senza stato: lo stato è per commessa)."""
    if id_lav in visitati:
        return None
    visitati = visitati | {id_lav}
    lav = q_one("SELECT id, id_macchina, id_processo, id_semilavorato, tav_padre "
                "FROM lavorazioni WHERE id = :id", id=id_lav)
    if not lav:
        return None

    materiali = [{
        "id": r["id"],
        "id_materiale": r["id_materiale"],
        "codice": r["codice"],
        "descrizione": r["descrizione"],
        "quantita_richiesta": r["quantita"],
        "quantita_stock": r["stock"],
        "tipo": "rich_mat"
    } for r in q_all(
        "SELECT r.id, r.id_materiale, r.quantita, "
        "       m.CodiceMateriale AS codice, m.Descrizione AS descrizione, m.Quantita AS stock "
        "FROM rich_mat r JOIN materialeMagazzino m ON r.id_materiale = m.id "
        "WHERE r.id_lavorazione = :id", id=id_lav)]

    figli = []
    for sub in q_all("SELECT id FROM lavorazioni WHERE tav_padre = :id", id=id_lav):
        figlio = build_albero_lavorazione(sub["id"], visitati)
        if figlio:
            figli.append(figlio)

    return {
        "id": lav["id"],
        "descrizione": desc_processo(lav),
        "tipo": "lavorazione",
        "semilavorato": bool(lav["id_semilavorato"]),
        "rich_mat": materiali,
        "figli": figli
    }


def serializza_richmat_diretti_catalogo(id_macchina):
    """Materiali attaccati direttamente alla macchina (senza processo) — vista catalogo."""
    return [{
        "id": r["id"], "id_materiale": r["id_materiale"],
        "codice": r["codice"], "descrizione": r["descrizione"],
        "quantita_richiesta": r["quantita"], "quantita_stock": r["stock"],
        "tipo": "rich_mat"
    } for r in q_all(
        "SELECT r.id, r.id_materiale, r.quantita, "
        "       m.CodiceMateriale AS codice, m.Descrizione AS descrizione, m.Quantita AS stock "
        "FROM rich_mat r JOIN materialeMagazzino m ON r.id_materiale = m.id "
        "WHERE r.id_macchina = :idm AND r.id_lavorazione IS NULL", idm=id_macchina)]


def stato_lavorazione_cm(cm_id, cm_quantita, id_lav):
    """Stato DERIVATO di una lavorazione per una macchina-in-commessa, dalle forniture.
    Target di ogni materiale = quantita richiesta × n° macchine in commessa."""
    richs = q_all(
        "SELECT r.quantita, COALESCE(f.quantita_fornita, 0) AS fornita "
        "FROM rich_mat r "
        "LEFT JOIN fornitura_materiali f ON f.id_rich_mat = r.id AND f.id_commessa_macchina = :cm "
        "WHERE r.id_lavorazione = :lav", cm=cm_id, lav=id_lav)
    if not richs:
        return "COMPLETATA"  # nessun materiale da conferire: non blocca la sequenza
    completi = 0
    parziali = 0
    for r in richs:
        target = r["quantita"] * cm_quantita
        forn = r["fornita"]
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
    """Albero OPERATIVO per una macchina-in-commessa: stato derivato, forniture, lock sequenza.
    `cm` è un dizionario con chiavi id, id_macchina, quantita."""
    if id_lav in visitati:
        return None
    visitati = visitati | {id_lav}
    lav = q_one("SELECT id, id_macchina, id_processo, id_semilavorato, tav_padre "
                "FROM lavorazioni WHERE id = :id", id=id_lav)
    if not lav:
        return None

    stato = stato_lavorazione_cm(cm["id"], cm["quantita"], id_lav)

    materiali = [{
        "rich_mat_id": r["id"],
        "id_materiale": r["id_materiale"],
        "codice": r["codice"],
        "descrizione": r["descrizione"],
        "quantita_richiesta": r["quantita"],
        "target": r["quantita"] * cm["quantita"],
        "quantita_fornita": r["fornita"],
        "quantita_stock": r["stock"],
        "tipo": "rich_mat"
    } for r in q_all(
        "SELECT r.id, r.id_materiale, r.quantita, "
        "       m.CodiceMateriale AS codice, m.Descrizione AS descrizione, m.Quantita AS stock, "
        "       COALESCE(f.quantita_fornita, 0) AS fornita "
        "FROM rich_mat r "
        "JOIN materialeMagazzino m ON r.id_materiale = m.id "
        "LEFT JOIN fornitura_materiali f ON f.id_rich_mat = r.id AND f.id_commessa_macchina = :cm "
        "WHERE r.id_lavorazione = :lav", cm=cm["id"], lav=id_lav)]

    figli = []
    completa = (stato == "COMPLETATA")
    for sub in q_all("SELECT id FROM lavorazioni WHERE tav_padre = :id", id=id_lav):
        figlio = build_albero_commessa(cm, sub["id"], completa, visitati)
        if figlio:
            figli.append(figlio)

    return {
        "id": lav["id"],
        "descrizione": desc_processo(lav),
        "tipo": "lavorazione",
        "stato": stato,
        "bloccato": not padre_completo,   # sbloccato solo se il processo precedente è COMPLETATA
        "rich_mat": materiali,
        "figli": figli
    }


def serializza_richmat_diretti_commessa(cm):
    """Materiali diretti della macchina (senza processo) — vista operativa commessa."""
    return [{
        "rich_mat_id": r["id"], "id_materiale": r["id_materiale"],
        "codice": r["codice"], "descrizione": r["descrizione"],
        "quantita_richiesta": r["quantita"], "target": r["quantita"] * cm["quantita"],
        "quantita_fornita": r["fornita"],
        "quantita_stock": r["stock"], "tipo": "rich_mat"
    } for r in q_all(
        "SELECT r.id, r.id_materiale, r.quantita, "
        "       m.CodiceMateriale AS codice, m.Descrizione AS descrizione, m.Quantita AS stock, "
        "       COALESCE(f.quantita_fornita, 0) AS fornita "
        "FROM rich_mat r "
        "JOIN materialeMagazzino m ON r.id_materiale = m.id "
        "LEFT JOIN fornitura_materiali f ON f.id_rich_mat = r.id AND f.id_commessa_macchina = :cm "
        "WHERE r.id_macchina = :idm AND r.id_lavorazione IS NULL", cm=cm["id"], idm=cm["id_macchina"])]


def progresso_commessa(id_commessa):
    """Percentuale di avanzamento: unità fornite / unità totali sui materiali foglia della commessa."""
    forn = 0.0
    tot = 0.0
    for cm in q_all("SELECT id, id_macchina, quantita FROM commessa_macchine WHERE id_commessa = :idc", idc=id_commessa):
        # materiali sotto i processi della macchina + materiali diretti della macchina
        richs = q_all(
            "SELECT r.id, r.quantita FROM rich_mat r "
            "JOIN lavorazioni l ON r.id_lavorazione = l.id WHERE l.id_macchina = :idm "
            "UNION ALL "
            "SELECT r.id, r.quantita FROM rich_mat r "
            "WHERE r.id_macchina = :idm AND r.id_lavorazione IS NULL", idm=cm["id_macchina"])
        for r in richs:
            target = r["quantita"] * cm["quantita"]
            f = q_one("SELECT quantita_fornita FROM fornitura_materiali "
                      "WHERE id_commessa_macchina = :cm AND id_rich_mat = :rm", cm=cm["id"], rm=r["id"])
            forn += min(f["quantita_fornita"] if f else 0, target)
            tot += target
    return round(100 * forn / tot) if tot > 0 else 0


def espandi_semilavorato(id_sem, id_macchina, tav_padre, mult, visitati):
    """Istanzia la ricetta di un semilavorato come sotto-albero di lavorazioni+materiali sulla macchina.
    Ricorsivo (con anti-ciclo) per semilavorati annidati. Solo le materie prime foglia hanno stock.
    NB: gli INSERT restano nella transazione corrente; il commit lo fa l'endpoint chiamante."""
    if id_sem in visitati:
        return None
    visitati = visitati | {id_sem}
    s = q_one("SELECT id, id_processo FROM semilavorati WHERE id = :id", id=id_sem)
    if not s:
        return None
    res = q_exec(
        "INSERT INTO lavorazioni (id_macchina, id_processo, id_semilavorato, tav_padre) "
        "VALUES (:idm, :idp, :ids, :pad)",
        commit=False, idm=id_macchina, idp=s["id_processo"], ids=s["id"], pad=tav_padre)
    new_lav_id = res.lastrowid
    for comp in q_all("SELECT id_materiale, id_semilavorato_comp, quantita "
                      "FROM semilavorato_componenti WHERE id_semilavorato = :id", id=id_sem):
        q = (comp["quantita"] or 1) * mult
        if comp["id_semilavorato_comp"]:
            espandi_semilavorato(comp["id_semilavorato_comp"], id_macchina, new_lav_id, q, visitati)
        elif comp["id_materiale"]:
            q_exec("INSERT INTO rich_mat (id_lavorazione, id_materiale, quantita) "
                   "VALUES (:lav, :mat, :q)", commit=False, lav=new_lav_id, mat=comp["id_materiale"], q=q)
    return new_lav_id


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

    utente = q_one("SELECT password, nome, cognome FROM utenti "
                   "WHERE identificatore_login = :u AND ruolo = 'Dipendente'", u=username)
    if utente and utente["password"] and bcrypt.checkpw(password.encode(), utente["password"].encode()):
        token = create_access_token(
            identity=username,
            additional_claims={"ruolo": "dipendente", "nome": utente["nome"] or "", "cognome": utente["cognome"] or ""}
        )
        return jsonify({"token": token}), 200

    return jsonify({"errore": "Credenziali Errate"}), 401


# ── CLIENTI ───────────────────────────────────────────────────────────────────

@app.route("/clienti", methods=["GET"])
@jwt_required()
def get_clienti():
    return jsonify([{
        "id": c["id"], "nome_cliente": c["nome_cliente"], "partita_iva": c["partita_iva"] or ""
    } for c in q_all("SELECT id, nome_cliente, partita_iva FROM clienti")])

@app.route("/clienti", methods=["POST"])
@jwt_required()
def crea_cliente():
    data = request.get_json()
    if not data or not data.get("nome_cliente"):
        return jsonify({"errore": "nome_cliente obbligatorio"}), 400
    res = q_exec("INSERT INTO clienti (nome_cliente, partita_iva) VALUES (:n, :p)",
                 n=data["nome_cliente"], p=data.get("partita_iva"))
    return jsonify({"messaggio": "Cliente creato", "id": res.lastrowid}), 201

@app.route("/clienti/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_cliente(id):
    cliente = q_one("SELECT id, nome_cliente, partita_iva FROM clienti WHERE id = :id", id=id)
    if not cliente:
        return jsonify({"errore": "Cliente non trovato"}), 404
    data = request.get_json() or {}
    q_exec("UPDATE clienti SET nome_cliente = :n, partita_iva = :p WHERE id = :id",
           n=data.get("nome_cliente", cliente["nome_cliente"]),
           p=data.get("partita_iva", cliente["partita_iva"]), id=id)
    return jsonify({"messaggio": "Cliente aggiornato"}), 200

@app.route("/clienti/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_cliente(id):
    if not q_one("SELECT id FROM clienti WHERE id = :id", id=id):
        return jsonify({"errore": "Cliente non trovato"}), 404
    q_exec("DELETE FROM clienti WHERE id = :id", id=id)
    return jsonify({"messaggio": "Cliente eliminato"}), 200


# ── COMMESSE ──────────────────────────────────────────────────────────────────

@app.route("/commesse", methods=["GET"])
@jwt_required()
def get_commesse():
    out = []
    for c in q_all("SELECT id, codice_commessa, id_cliente, descrizione, anno, data_consegna, stato_chiusura FROM commesse"):
        out.append({
            "id": c["id"],
            "codice": c["codice_commessa"],
            "id_cliente": c["id_cliente"],
            "descrizione": c["descrizione"],
            "anno": c["anno"],
            "data_consegna": c["data_consegna"].isoformat() if c["data_consegna"] else None,
            "stato": c["stato_chiusura"],
            "progresso": progresso_commessa(c["id"])
        })
    return jsonify(out)

@app.route("/commesse", methods=["POST"])
@jwt_required()
def crea_commessa():
    data = request.get_json()
    if not data:
        return jsonify({"errore": "Dati mancanti"}), 400
    res = q_exec(
        "INSERT INTO commesse (codice_commessa, id_cliente, descrizione, anno, data_consegna, stato_chiusura) "
        "VALUES (:cod, :cli, :descr, :anno, :data, :stato)",
        cod=data.get("codice_commessa"), cli=data.get("id_cliente"), descr=data.get("descrizione"),
        anno=data.get("anno"), data=data.get("data_consegna"), stato=data.get("stato_chiusura", "APERTA"))
    return jsonify({"messaggio": "Commessa creata", "id": res.lastrowid}), 201

@app.route("/commesse/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_commessa(id):
    c = q_one("SELECT * FROM commesse WHERE id = :id", id=id)
    if not c:
        return jsonify({"errore": "Commessa non trovata"}), 404
    data = request.get_json() or {}
    q_exec(
        "UPDATE commesse SET codice_commessa = :cod, id_cliente = :cli, descrizione = :descr, "
        "anno = :anno, data_consegna = :data, stato_chiusura = :stato WHERE id = :id",
        cod=data.get("codice_commessa", c["codice_commessa"]),
        cli=data.get("id_cliente", c["id_cliente"]),
        descr=data.get("descrizione", c["descrizione"]),
        anno=data.get("anno", c["anno"]),
        data=data.get("data_consegna", c["data_consegna"]),
        stato=data.get("stato_chiusura", c["stato_chiusura"]), id=id)
    return jsonify({"messaggio": "Commessa aggiornata"}), 200

@app.route("/commesse/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_commessa(id):
    if not q_one("SELECT id FROM commesse WHERE id = :id", id=id):
        return jsonify({"errore": "Commessa non trovata"}), 404
    q_exec("DELETE FROM commesse WHERE id = :id", id=id)
    return jsonify({"messaggio": "Commessa eliminata"}), 200

@app.route("/commesse/<int:id>/macchine", methods=["GET"])
@jwt_required()
def get_macchine_commessa(id):
    return jsonify([{
        "id": e["id_macchina"], "link_id": e["id"],
        "codice": e["codice"], "descrizione": e["descrizione"],
        "quantita": e["quantita"], "stato": e["stato"]
    } for e in q_all(
        "SELECT cm.id, cm.id_macchina, cm.quantita, cm.stato, m.codice, m.descrizione "
        "FROM commessa_macchine cm JOIN macchine m ON cm.id_macchina = m.id "
        "WHERE cm.id_commessa = :id", id=id)]), 200

@app.route("/commesse/<int:id>/macchine", methods=["POST"])
@jwt_required()
def aggiungi_macchina_commessa(id):
    data = request.get_json()
    if not data or not data.get("id_macchina"):
        return jsonify({"errore": "id_macchina obbligatorio"}), 400
    res = q_exec(
        "INSERT INTO commessa_macchine (id_commessa, id_macchina, quantita, stato) "
        "VALUES (:idc, :idm, :q, :stato)",
        idc=id, idm=data["id_macchina"], q=data.get("quantita", 1), stato=data.get("stato", "IN_ATTESA"))
    return jsonify({"messaggio": "Macchina aggiunta alla commessa", "id": res.lastrowid}), 201

@app.route("/commesse/<int:id>/macchine/<int:link_id>", methods=["DELETE"])
@jwt_required()
def rimuovi_macchina_commessa(id, link_id):
    if not q_one("SELECT id FROM commessa_macchine WHERE id = :lid AND id_commessa = :id", lid=link_id, id=id):
        return jsonify({"errore": "Associazione non trovata"}), 404
    q_exec("DELETE FROM commessa_macchine WHERE id = :lid AND id_commessa = :id", lid=link_id, id=id)
    return jsonify({"messaggio": "Macchina rimossa dalla commessa"}), 200

@app.route("/commesse/<int:id>/albero", methods=["GET"])
@jwt_required()
def get_albero_commessa(id):
    """Albero operativo della commessa: commessa → macchine → processi/materiali,
    con stato derivato per processo, quantità fornite e lock di sequenza."""
    commessa = q_one("SELECT id, codice_commessa, descrizione FROM commesse WHERE id = :id", id=id)
    if not commessa:
        return jsonify({"errore": "Commessa non trovata"}), 404

    macchine = []
    for cm in q_all(
            "SELECT cm.id, cm.id_macchina, cm.quantita, m.codice, m.descrizione "
            "FROM commessa_macchine cm JOIN macchine m ON cm.id_macchina = m.id "
            "WHERE cm.id_commessa = :id", id=id):
        lavs = []
        for lav in q_all("SELECT id FROM lavorazioni WHERE id_macchina = :idm AND tav_padre IS NULL", idm=cm["id_macchina"]):
            albero = build_albero_commessa(cm, lav["id"], True, set())
            if albero:
                lavs.append(albero)
        macchine.append({
            "commessa_macchina_id": cm["id"],
            "id": cm["id_macchina"], "codice": cm["codice"], "descrizione": cm["descrizione"],
            "quantita": cm["quantita"], "tipo": "macchina",
            "lavorazioni": lavs,
            "materiali_diretti": serializza_richmat_diretti_commessa(cm)
        })

    return jsonify({
        "id": commessa["id"], "codice": commessa["codice_commessa"],
        "descrizione": commessa["descrizione"], "tipo": "commessa",
        "macchine": macchine
    }), 200


# ── FORNITURA MATERIALI (drag&drop operativo: scarico magazzino per commessa) ──

def _valida_fornitura(cm_id, rm_id):
    """Valida la coppia commessa-macchina / materiale richiesto.
    Il materiale può stare sotto un processo (lav) o essere diretto sulla macchina (lav=None)."""
    cm = q_one("SELECT id, id_macchina, quantita FROM commessa_macchine WHERE id = :id", id=cm_id)
    rm = q_one("SELECT id, id_lavorazione, id_macchina, id_materiale, quantita FROM rich_mat WHERE id = :id", id=rm_id)
    if not cm or not rm:
        return None, None, None, (jsonify({"errore": "Commessa-macchina o materiale non trovato"}), 404)
    lav = q_one("SELECT id, id_macchina, tav_padre FROM lavorazioni WHERE id = :id", id=rm["id_lavorazione"]) if rm["id_lavorazione"] else None
    macchina_del_mat = lav["id_macchina"] if lav else rm["id_macchina"]
    if macchina_del_mat != cm["id_macchina"]:
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
    if lav and lav["tav_padre"] and stato_lavorazione_cm(cm["id"], cm["quantita"], lav["tav_padre"]) != "COMPLETATA":
        return jsonify({"errore": "Il processo precedente non è ancora completato"}), 409

    target = rm["quantita"] * cm["quantita"]
    f = q_one("SELECT id, quantita_fornita FROM fornitura_materiali "
              "WHERE id_commessa_macchina = :cm AND id_rich_mat = :rm", cm=cm["id"], rm=rm["id"])
    forn = f["quantita_fornita"] if f else 0
    if forn >= target:
        return jsonify({"errore": "Materiale già completo"}), 409

    mat = q_one("SELECT id, Quantita FROM materialeMagazzino WHERE id = :id", id=rm["id_materiale"])
    if not mat or (mat["Quantita"] or 0) < 1:
        return jsonify({"errore": "Stock insufficiente in magazzino"}), 409

    # scarico magazzino + avanzamento fornitura (stessa transazione)
    q_exec("UPDATE materialeMagazzino SET Quantita = Quantita - 1 WHERE id = :id", commit=False, id=rm["id_materiale"])
    if f:
        q_exec("UPDATE fornitura_materiali SET quantita_fornita = quantita_fornita + 1 WHERE id = :id", commit=False, id=f["id"])
        nuova_forn = forn + 1
    else:
        q_exec("INSERT INTO fornitura_materiali (id_commessa_macchina, id_rich_mat, quantita_fornita) "
               "VALUES (:cm, :rm, 1)", commit=False, cm=cm["id"], rm=rm["id"])
        nuova_forn = 1
    db.session.commit()

    return jsonify({
        "messaggio": "Materiale fornito",
        "quantita_fornita": nuova_forn,
        "target": target,
        "quantita_stock": (mat["Quantita"] or 0) - 1,
        "stato_lavorazione": stato_lavorazione_cm(cm["id"], cm["quantita"], lav["id"]) if lav else None
    }), 200

@app.route("/commessa-macchine/<int:cm_id>/rich_mat/<int:rm_id>/restituisci", methods=["POST"])
@jwt_required()
def restituisci_materiale(cm_id, rm_id):
    """Annulla 1 unità: rimette il pezzo in magazzino."""
    cm, rm, lav, err = _valida_fornitura(cm_id, rm_id)
    if err:
        return err

    f = q_one("SELECT id, quantita_fornita FROM fornitura_materiali "
              "WHERE id_commessa_macchina = :cm AND id_rich_mat = :rm", cm=cm["id"], rm=rm["id"])
    if not f or f["quantita_fornita"] <= 0:
        return jsonify({"errore": "Niente da restituire"}), 409

    q_exec("UPDATE fornitura_materiali SET quantita_fornita = quantita_fornita - 1 WHERE id = :id", commit=False, id=f["id"])
    q_exec("UPDATE materialeMagazzino SET Quantita = COALESCE(Quantita, 0) + 1 WHERE id = :id", commit=False, id=rm["id_materiale"])
    db.session.commit()

    mat = q_one("SELECT Quantita FROM materialeMagazzino WHERE id = :id", id=rm["id_materiale"])
    return jsonify({
        "messaggio": "Materiale restituito",
        "quantita_fornita": f["quantita_fornita"] - 1,
        "target": rm["quantita"] * cm["quantita"],
        "quantita_stock": mat["Quantita"] if mat else None,
        "stato_lavorazione": stato_lavorazione_cm(cm["id"], cm["quantita"], lav["id"]) if lav else None
    }), 200


# ── MACCHINE ──────────────────────────────────────────────────────────────────

@app.route("/macchine", methods=["GET"])
@jwt_required()
def get_macchine():
    return jsonify([{
        "id": m["id"], "codice": m["codice"], "descrizione": m["descrizione"]
    } for m in q_all("SELECT id, codice, descrizione FROM macchine")])

@app.route("/macchine", methods=["POST"])
@jwt_required()
def aggiungi_macchina():
    data = request.get_json()
    if not data:
        return jsonify({"errore": "Dati mancanti"}), 400
    res = q_exec("INSERT INTO macchine (codice, descrizione) VALUES (:c, :d)",
                 c=data.get("codice"), d=data.get("descrizione"))
    return jsonify({"messaggio": "Macchina aggiunta al catalogo", "id": res.lastrowid}), 201

@app.route("/macchine/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_macchina(id):
    m = q_one("SELECT codice, descrizione FROM macchine WHERE id = :id", id=id)
    if not m:
        return jsonify({"errore": "Macchina non trovata"}), 404
    data = request.get_json() or {}
    q_exec("UPDATE macchine SET codice = :c, descrizione = :d WHERE id = :id",
           c=data.get("codice", m["codice"]), d=data.get("descrizione", m["descrizione"]), id=id)
    return jsonify({"messaggio": "Macchina aggiornata"}), 200

@app.route("/macchine/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_macchina(id):
    if not q_one("SELECT id FROM macchine WHERE id = :id", id=id):
        return jsonify({"errore": "Macchina non trovata"}), 404
    q_exec("DELETE FROM macchine WHERE id = :id", id=id)
    return jsonify({"messaggio": "Macchina eliminata"}), 200

@app.route("/macchine/<int:id>/lavorazioni", methods=["GET"])
@jwt_required()
def get_lavorazioni_macchina(id):
    return jsonify([{
        "id": l["id"], "descrizione": desc_processo(l),
        "id_processo": l["id_processo"], "tav_padre": l["tav_padre"]
    } for l in q_all("SELECT id, id_macchina, id_processo, id_semilavorato, tav_padre FROM lavorazioni WHERE id_macchina = :id", id=id)]), 200

@app.route("/macchine/<int:id>/albero", methods=["GET"])
@jwt_required()
def get_albero_macchina(id):
    macchina = q_one("SELECT id, codice, descrizione FROM macchine WHERE id = :id", id=id)
    if not macchina:
        return jsonify({"errore": "Macchina non trovata"}), 404

    lavorazioni = []
    for lav in q_all("SELECT id FROM lavorazioni WHERE id_macchina = :id AND tav_padre IS NULL", id=id):
        albero = build_albero_lavorazione(lav["id"], set())
        if albero:
            lavorazioni.append(albero)

    return jsonify({
        "id": macchina["id"], "codice": macchina["codice"],
        "descrizione": macchina["descrizione"], "tipo": "macchina",
        "lavorazioni": lavorazioni,
        "materiali_diretti": serializza_richmat_diretti_catalogo(id)
    }), 200

@app.route("/macchine/<int:id>/files", methods=["GET"])
@jwt_required()
def get_files_macchina(id):
    macchina = q_one("SELECT codice FROM macchine WHERE id = :id", id=id)
    if not macchina:
        return jsonify({"errore": "Macchina non trovata"}), 404
    codice = macchina["codice"]
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
        "id": p["id"], "descrizione": p["descrizione"]
    } for p in q_all("SELECT id, descrizione FROM processi_tipo")])

@app.route("/processi", methods=["POST"])
@jwt_required()
def crea_processo():
    data = request.get_json()
    if not data or not data.get("descrizione"):
        return jsonify({"errore": "descrizione obbligatoria"}), 400
    res = q_exec("INSERT INTO processi_tipo (descrizione) VALUES (:d)", d=data["descrizione"])
    return jsonify({"messaggio": "Processo creato", "id": res.lastrowid}), 201

@app.route("/processi/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_processo(id):
    p = q_one("SELECT descrizione FROM processi_tipo WHERE id = :id", id=id)
    if not p:
        return jsonify({"errore": "Processo non trovato"}), 404
    data = request.get_json() or {}
    q_exec("UPDATE processi_tipo SET descrizione = :d WHERE id = :id",
           d=data.get("descrizione", p["descrizione"]), id=id)
    return jsonify({"messaggio": "Processo aggiornato"}), 200

@app.route("/processi/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_processo(id):
    if not q_one("SELECT id FROM processi_tipo WHERE id = :id", id=id):
        return jsonify({"errore": "Processo non trovato"}), 404
    usi = q_scalar("SELECT COUNT(*) FROM lavorazioni WHERE id_processo = :id", id=id)
    if usi:
        return jsonify({"errore": "Processo usato da %d macchina/e: rimuovilo prima da quelle." % usi}), 409
    q_exec("DELETE FROM processi_tipo WHERE id = :id", id=id)
    return jsonify({"messaggio": "Processo eliminato"}), 200


# ── SEMILAVORATI (catalogo: lavorazione + componenti) ─────────────────────────

@app.route("/semilavorati", methods=["GET"])
@jwt_required()
def get_semilavorati():
    return jsonify([{
        "id": s["id"], "codice": s["codice"], "descrizione": s["descrizione"],
        "id_processo": s["id_processo"], "processo": s["processo"]
    } for s in q_all(
        "SELECT s.id, s.codice, s.descrizione, s.id_processo, p.descrizione AS processo "
        "FROM semilavorati s LEFT JOIN processi_tipo p ON s.id_processo = p.id")])

@app.route("/semilavorati", methods=["POST"])
@jwt_required()
def crea_semilavorato():
    data = request.get_json()
    if not data or not data.get("descrizione"):
        return jsonify({"errore": "descrizione obbligatoria"}), 400
    res = q_exec("INSERT INTO semilavorati (codice, descrizione, id_processo) VALUES (:c, :d, :p)",
                 c=data.get("codice"), d=data.get("descrizione"), p=data.get("id_processo") or None)
    return jsonify({"messaggio": "Semilavorato creato", "id": res.lastrowid}), 201

@app.route("/semilavorati/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_semilavorato(id):
    s = q_one("SELECT codice, descrizione, id_processo FROM semilavorati WHERE id = :id", id=id)
    if not s:
        return jsonify({"errore": "Semilavorato non trovato"}), 404
    data = request.get_json() or {}
    id_processo = (data.get("id_processo") or None) if "id_processo" in data else s["id_processo"]
    q_exec("UPDATE semilavorati SET codice = :c, descrizione = :d, id_processo = :p WHERE id = :id",
           c=data.get("codice", s["codice"]), d=data.get("descrizione", s["descrizione"]),
           p=id_processo, id=id)
    return jsonify({"messaggio": "Semilavorato aggiornato"}), 200

@app.route("/semilavorati/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_semilavorato(id):
    if not q_one("SELECT id FROM semilavorati WHERE id = :id", id=id):
        return jsonify({"errore": "Semilavorato non trovato"}), 404
    usi_lav = q_scalar("SELECT COUNT(*) FROM lavorazioni WHERE id_semilavorato = :id", id=id)
    usi_comp = q_scalar("SELECT COUNT(*) FROM semilavorato_componenti WHERE id_semilavorato_comp = :id", id=id)
    if usi_lav or usi_comp:
        return jsonify({"errore": "Semilavorato in uso (in macchine o in altre ricette): rimuovilo prima da lì."}), 409
    q_exec("DELETE FROM semilavorato_componenti WHERE id_semilavorato = :id", commit=False, id=id)
    q_exec("DELETE FROM semilavorati WHERE id = :id", commit=False, id=id)
    db.session.commit()
    return jsonify({"messaggio": "Semilavorato eliminato"}), 200

@app.route("/semilavorati/<int:id>/componenti", methods=["GET"])
@jwt_required()
def get_componenti_semilavorato(id):
    out = []
    for comp in q_all("SELECT id, id_materiale, id_semilavorato_comp, quantita "
                      "FROM semilavorato_componenti WHERE id_semilavorato = :id", id=id):
        if comp["id_semilavorato_comp"]:
            sc = q_one("SELECT codice, descrizione FROM semilavorati WHERE id = :id", id=comp["id_semilavorato_comp"])
            out.append({"id": comp["id"], "tipo": "semilavorato", "rif_id": comp["id_semilavorato_comp"],
                        "codice": sc["codice"] if sc else None, "descrizione": sc["descrizione"] if sc else None,
                        "quantita": comp["quantita"]})
        else:
            mat = q_one("SELECT CodiceMateriale, Descrizione FROM materialeMagazzino WHERE id = :id", id=comp["id_materiale"])
            out.append({"id": comp["id"], "tipo": "materiale", "rif_id": comp["id_materiale"],
                        "codice": mat["CodiceMateriale"] if mat else None, "descrizione": mat["Descrizione"] if mat else None,
                        "quantita": comp["quantita"]})
    return jsonify(out), 200

@app.route("/semilavorati/<int:id>/componenti", methods=["POST"])
@jwt_required()
def aggiungi_componente_semilavorato(id):
    if not q_one("SELECT id FROM semilavorati WHERE id = :id", id=id):
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
    res = q_exec(
        "INSERT INTO semilavorato_componenti (id_semilavorato, id_materiale, id_semilavorato_comp, quantita) "
        "VALUES (:s, :mat, :sc, :q)",
        s=id, mat=id_mat or None, sc=id_sem or None, q=qty)
    return jsonify({"messaggio": "Componente aggiunto", "id": res.lastrowid}), 201

@app.route("/semilavorato_componenti/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_componente_semilavorato(id):
    if not q_one("SELECT id FROM semilavorato_componenti WHERE id = :id", id=id):
        return jsonify({"errore": "Componente non trovato"}), 404
    q_exec("DELETE FROM semilavorato_componenti WHERE id = :id", id=id)
    return jsonify({"messaggio": "Componente rimosso"}), 200

@app.route("/lavorazioni/<int:id>/semilavorato", methods=["POST"])
@jwt_required()
def aggiungi_semilavorato_lavorazione(id):
    """Aggiunge (espandendo) un semilavorato come sotto-processo di una lavorazione."""
    lav = q_one("SELECT id, id_macchina FROM lavorazioni WHERE id = :id", id=id)
    if not lav:
        return jsonify({"errore": "Lavorazione non trovata"}), 404
    data = request.get_json() or {}
    if not data.get("id_semilavorato"):
        return jsonify({"errore": "id_semilavorato obbligatorio"}), 400
    qty = float(data.get("quantita", 1))
    espandi_semilavorato(data["id_semilavorato"], lav["id_macchina"], lav["id"], qty, set())
    db.session.commit()
    return jsonify({"messaggio": "Semilavorato aggiunto"}), 201

@app.route("/macchine/<int:id>/semilavorato", methods=["POST"])
@jwt_required()
def aggiungi_semilavorato_macchina(id):
    """Aggiunge (espandendo) un semilavorato direttamente sulla macchina (processo radice)."""
    if not q_one("SELECT id FROM macchine WHERE id = :id", id=id):
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
        "id": l["id"], "descrizione": desc_processo(l),
        "id_processo": l["id_processo"],
        "id_macchina": l["id_macchina"], "tav_padre": l["tav_padre"]
    } for l in q_all("SELECT id, id_macchina, id_processo, id_semilavorato, tav_padre FROM lavorazioni")])

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
        padre = q_one("SELECT id_macchina FROM lavorazioni WHERE id = :id", id=tav_padre)
        if not padre or padre["id_macchina"] != int(data.get("id_macchina")):
            return jsonify({"errore": "tav_padre non valido o appartiene ad altra macchina"}), 400

    res = q_exec("INSERT INTO lavorazioni (id_macchina, id_processo, tav_padre) VALUES (:idm, :idp, :pad)",
                 idm=data.get("id_macchina"), idp=data.get("id_processo"), pad=tav_padre)
    return jsonify({"messaggio": "Lavorazione creata", "id": res.lastrowid}), 201

@app.route("/lavorazioni/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_lavorazione(id):
    lav = q_one("SELECT id_processo, tav_padre FROM lavorazioni WHERE id = :id", id=id)
    if not lav:
        return jsonify({"errore": "Lavorazione non trovata"}), 404
    data = request.get_json() or {}
    tav_padre = data.get("tav_padre", lav["tav_padre"]) or None
    q_exec("UPDATE lavorazioni SET id_processo = :idp, tav_padre = :pad WHERE id = :id",
           idp=data.get("id_processo", lav["id_processo"]), pad=tav_padre, id=id)
    return jsonify({"messaggio": "Lavorazione aggiornata"}), 200

def _elimina_lavorazione_ricorsiva(id_lav):
    """Elimina una lavorazione, i suoi sotto-processi e i materiali richiesti.
    Le forniture si cancellano in cascade sul DELETE delle rich_mat (FK ON DELETE CASCADE)."""
    for sub in q_all("SELECT id FROM lavorazioni WHERE tav_padre = :id", id=id_lav):
        _elimina_lavorazione_ricorsiva(sub["id"])
    q_exec("DELETE FROM rich_mat WHERE id_lavorazione = :id", commit=False, id=id_lav)
    q_exec("DELETE FROM lavorazioni WHERE id = :id", commit=False, id=id_lav)

@app.route("/lavorazioni/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_lavorazione(id):
    if not q_one("SELECT id FROM lavorazioni WHERE id = :id", id=id):
        return jsonify({"errore": "Lavorazione non trovata"}), 404
    _elimina_lavorazione_ricorsiva(id)
    db.session.commit()
    return jsonify({"messaggio": "Lavorazione eliminata"}), 200

@app.route("/lavorazioni/<int:id>/rich_mat", methods=["GET"])
@jwt_required()
def get_rich_mat_lavorazione(id):
    return jsonify([{
        "id": r["id"],
        "id_materiale": r["id_materiale"],
        "codice": r["codice"],
        "descrizione": r["descrizione"],
        "quantita_richiesta": r["quantita"],
        "quantita_stock": r["stock"]
    } for r in q_all(
        "SELECT r.id, r.id_materiale, r.quantita, "
        "       m.CodiceMateriale AS codice, m.Descrizione AS descrizione, m.Quantita AS stock "
        "FROM rich_mat r JOIN materialeMagazzino m ON r.id_materiale = m.id "
        "WHERE r.id_lavorazione = :id", id=id)]), 200

@app.route("/lavorazioni/<int:id>/rich_mat", methods=["POST"])
@jwt_required()
def aggiungi_rich_mat(id):
    data = request.get_json()
    if not data or not data.get("id_materiale"):
        return jsonify({"errore": "id_materiale obbligatorio"}), 400
    qty = float(data.get("quantita", 1))
    if qty <= 0:
        return jsonify({"errore": "Quantità deve essere maggiore di zero"}), 400
    res = q_exec("INSERT INTO rich_mat (id_lavorazione, id_materiale, quantita) VALUES (:lav, :mat, :q)",
                 lav=id, mat=data.get("id_materiale"), q=qty)
    return jsonify({"messaggio": "Materiale aggiunto", "id": res.lastrowid}), 201

@app.route("/macchine/<int:id>/rich_mat", methods=["POST"])
@jwt_required()
def aggiungi_rich_mat_macchina(id):
    """Materiale richiesto DIRETTO sulla macchina (senza processo, montato as-is)."""
    if not q_one("SELECT id FROM macchine WHERE id = :id", id=id):
        return jsonify({"errore": "Macchina non trovata"}), 404
    data = request.get_json()
    if not data or not data.get("id_materiale"):
        return jsonify({"errore": "id_materiale obbligatorio"}), 400
    qty = float(data.get("quantita", 1))
    if qty <= 0:
        return jsonify({"errore": "Quantità deve essere maggiore di zero"}), 400
    res = q_exec("INSERT INTO rich_mat (id_macchina, id_materiale, quantita) VALUES (:idm, :mat, :q)",
                 idm=id, mat=data.get("id_materiale"), q=qty)
    return jsonify({"messaggio": "Materiale diretto aggiunto", "id": res.lastrowid}), 201


# ── RICH MAT (singolo) ────────────────────────────────────────────────────────

@app.route("/rich_mat/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_rich_mat(id):
    r = q_one("SELECT id_materiale, quantita FROM rich_mat WHERE id = :id", id=id)
    if not r:
        return jsonify({"errore": "Richiesta non trovata"}), 404
    data = request.get_json() or {}
    qty = data.get("quantita", r["quantita"])
    if qty is not None and float(qty) <= 0:
        return jsonify({"errore": "Quantità deve essere maggiore di zero"}), 400
    q_exec("UPDATE rich_mat SET id_materiale = :mat, quantita = :q WHERE id = :id",
           mat=data.get("id_materiale", r["id_materiale"]), q=qty, id=id)
    return jsonify({"messaggio": "Richiesta aggiornata"}), 200

@app.route("/rich_mat/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_rich_mat(id):
    if not q_one("SELECT id FROM rich_mat WHERE id = :id", id=id):
        return jsonify({"errore": "Richiesta non trovata"}), 404
    q_exec("DELETE FROM rich_mat WHERE id = :id", id=id)
    return jsonify({"messaggio": "Richiesta eliminata"}), 200


# ── MATERIALE (catalogo) ──────────────────────────────────────────────────────

@app.route("/materiale", methods=["GET"])
@jwt_required()
def get_materiale():
    return jsonify([{
        "id": m["id"], "codice": m["CodiceMateriale"],
        "descrizione": m["Descrizione"], "quantita": m["Quantita"]
    } for m in q_all("SELECT id, CodiceMateriale, Descrizione, Quantita FROM materialeMagazzino")])

@app.route("/materiale", methods=["POST"])
@jwt_required()
def aggiungi_materiale():
    data = request.get_json()
    if not data:
        return jsonify({"errore": "Dati mancanti"}), 400
    qty = data.get("quantita", 0)
    if qty is not None and float(qty) < 0:
        return jsonify({"errore": "La quantità non può essere negativa"}), 400
    res = q_exec("INSERT INTO materialeMagazzino (CodiceMateriale, Descrizione, Quantita) VALUES (:c, :d, :q)",
                 c=data.get("codice"), d=data.get("descrizione"), q=qty)
    return jsonify({"messaggio": "Materiale aggiunto", "id": res.lastrowid}), 201

@app.route("/materiale/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_materiale(id):
    mat = q_one("SELECT CodiceMateriale, Descrizione, Quantita FROM materialeMagazzino WHERE id = :id", id=id)
    if not mat:
        return jsonify({"errore": "Materiale non trovato"}), 404
    data = request.get_json() or {}
    qty = data.get("quantita", mat["Quantita"])
    if qty is not None and float(qty) < 0:
        return jsonify({"errore": "La quantità non può essere negativa"}), 400
    q_exec("UPDATE materialeMagazzino SET CodiceMateriale = :c, Descrizione = :d, Quantita = :q WHERE id = :id",
           c=data.get("codice", mat["CodiceMateriale"]), d=data.get("descrizione", mat["Descrizione"]),
           q=qty, id=id)
    return jsonify({"messaggio": "Materiale aggiornato"}), 200

@app.route("/materiale/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_materiale(id):
    if not q_one("SELECT id FROM materialeMagazzino WHERE id = :id", id=id):
        return jsonify({"errore": "Materiale non trovato"}), 404
    q_exec("DELETE FROM materialeMagazzino WHERE id = :id", id=id)
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
        "id": u["id"], "identificatore_login": u["identificatore_login"],
        "nome": u["nome"] or "", "cognome": u["cognome"] or "", "ruolo": u["ruolo"]
    } for u in q_all("SELECT id, identificatore_login, nome, cognome, ruolo FROM utenti WHERE ruolo = 'Dipendente'")]), 200

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
    if q_one("SELECT id FROM utenti WHERE identificatore_login = :i", i=identificatore):
        return jsonify({"errore": "Identificatore già in uso"}), 409
    res = q_exec(
        "INSERT INTO utenti (identificatore_login, password, nome, cognome, ruolo) "
        "VALUES (:i, :p, :n, :c, 'Dipendente')",
        i=identificatore,
        p=bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode(),
        n=data.get("nome", "").strip(), c=data.get("cognome", "").strip())
    return jsonify({"messaggio": "Utente creato", "id": res.lastrowid}), 201

@app.route("/utenti/<int:id>/password", methods=["PUT"])
@admin_required
def cambia_password_utente(id):
    if not q_one("SELECT id FROM utenti WHERE id = :id", id=id):
        return jsonify({"errore": "Utente non trovato"}), 404
    data = request.get_json()
    nuova = data.get("password", "")
    if not nuova:
        return jsonify({"errore": "Password mancante"}), 400
    q_exec("UPDATE utenti SET password = :p WHERE id = :id",
           p=bcrypt.hashpw(nuova.encode(), bcrypt.gensalt(rounds=12)).decode(), id=id)
    return jsonify({"messaggio": "Password aggiornata"}), 200

@app.route("/utenti/<int:id>", methods=["DELETE"])
@admin_required
def elimina_utente(id):
    if not q_one("SELECT id FROM utenti WHERE id = :id", id=id):
        return jsonify({"errore": "Utente non trovato"}), 404
    q_exec("DELETE FROM utenti WHERE id = :id", id=id)
    return jsonify({"messaggio": "Utente eliminato"}), 200


# ── AVVIO ─────────────────────────────────────────────────────────────────────

with app.app_context():
    db.create_all()
    print("[DB] Database pronto.")

if __name__ == "__main__":
    app.run(port=5001, debug=True)
