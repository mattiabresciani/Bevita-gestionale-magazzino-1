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
    id_commessa = db.Column(db.Integer, db.ForeignKey('commesse.id'), nullable=True)
    quantita    = db.Column(db.Integer, default=1)
    stato       = db.Column(db.Enum('IN_ATTESA', 'IN_CORSO', 'COMPLETATA'), default='IN_ATTESA')

class Lavorazione(db.Model):
    __tablename__ = 'lavorazioni'
    id          = db.Column(db.Integer, primary_key=True)
    id_macchina = db.Column(db.Integer, db.ForeignKey('macchine.id'), nullable=False)
    descrizione = db.Column(db.String(255))
    tav_padre   = db.Column(db.Integer, db.ForeignKey('lavorazioni.id'), nullable=True)
    stato       = db.Column(db.Enum('IN_ATTESA', 'IN_CORSO', 'COMPLETATA'), default='IN_ATTESA')

class Materiale(db.Model):
    __tablename__ = 'materialeMagazzino'
    id              = db.Column(db.Integer, primary_key=True)
    CodiceMateriale = db.Column(db.String(50))
    Descrizione     = db.Column(db.String(255))
    Quantita        = db.Column(db.Integer, default=0)

class RichMat(db.Model):
    __tablename__ = 'rich_mat'
    id             = db.Column(db.Integer, primary_key=True)
    id_lavorazione = db.Column(db.Integer, db.ForeignKey('lavorazioni.id'), nullable=False)
    id_materiale   = db.Column(db.Integer, db.ForeignKey('materialeMagazzino.id'), nullable=False)
    quantita       = db.Column(db.Float, nullable=False, default=1)

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

def build_albero_lavorazione(id_lav, visitati):
    """Costruisce ricorsivamente l'albero di lavorazione (con rilevamento cicli)."""
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
        "descrizione": lav.descrizione,
        "stato": lav.stato,
        "tipo": "lavorazione",
        "rich_mat": materiali,
        "figli": figli
    }


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
        "stato": c.stato_chiusura
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
    macchine = Macchina.query.filter_by(id_commessa=id).all()
    return jsonify([{
        "id": m.id, "codice": m.codice, "descrizione": m.descrizione,
        "quantita": m.quantita, "stato": m.stato
    } for m in macchine]), 200


# ── MACCHINE ──────────────────────────────────────────────────────────────────

@app.route("/macchine", methods=["GET"])
@jwt_required()
def get_macchine():
    return jsonify([{
        "id": m.id, "codice": m.codice, "descrizione": m.descrizione,
        "id_commessa": m.id_commessa, "quantita": m.quantita, "stato": m.stato
    } for m in Macchina.query.all()])

@app.route("/macchine", methods=["POST"])
@jwt_required()
def aggiungi_macchina():
    data = request.get_json()
    if not data or not data.get("id_commessa"):
        return jsonify({"errore": "id_commessa obbligatorio"}), 400
    qty = data.get("quantita", 1)
    if qty is not None and float(qty) < 0:
        return jsonify({"errore": "La quantità non può essere negativa"}), 400
    nuova = Macchina(
        codice=data.get("codice"),
        descrizione=data.get("descrizione"),
        id_commessa=data.get("id_commessa"),
        quantita=qty,
        stato=data.get("stato", "IN_ATTESA")
    )
    db.session.add(nuova)
    db.session.commit()
    return jsonify({"messaggio": "Macchina aggiunta", "id": nuova.id}), 201

@app.route("/macchine/<int:id>", methods=["PUT"])
@jwt_required()
def modifica_macchina(id):
    macchina = Macchina.query.get(id)
    if not macchina:
        return jsonify({"errore": "Macchina non trovata"}), 404
    data = request.get_json() or {}
    qty = data.get("quantita", macchina.quantita)
    if qty is not None and float(qty) < 0:
        return jsonify({"errore": "La quantità non può essere negativa"}), 400
    macchina.codice      = data.get("codice", macchina.codice)
    macchina.descrizione = data.get("descrizione", macchina.descrizione)
    macchina.id_commessa = data.get("id_commessa", macchina.id_commessa)
    macchina.quantita    = qty
    macchina.stato       = data.get("stato", macchina.stato)
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
        "id": l.id, "descrizione": l.descrizione,
        "tav_padre": l.tav_padre, "stato": l.stato
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
        "quantita": macchina.quantita, "stato": macchina.stato,
        "lavorazioni": lavorazioni
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


# ── LAVORAZIONI ───────────────────────────────────────────────────────────────

@app.route("/lavorazioni", methods=["GET"])
@jwt_required()
def get_lavorazioni():
    return jsonify([{
        "id": l.id, "descrizione": l.descrizione,
        "id_macchina": l.id_macchina, "tav_padre": l.tav_padre, "stato": l.stato
    } for l in Lavorazione.query.all()])

@app.route("/lavorazioni", methods=["POST"])
@jwt_required()
def crea_lavorazione():
    data = request.get_json()
    if not data or not data.get("id_macchina"):
        return jsonify({"errore": "id_macchina obbligatorio"}), 400

    tav_padre = data.get("tav_padre") or None
    if tav_padre:
        padre = Lavorazione.query.get(tav_padre)
        if not padre or padre.id_macchina != int(data.get("id_macchina")):
            return jsonify({"errore": "tav_padre non valido o appartiene ad altra macchina"}), 400

    nuova = Lavorazione(
        id_macchina=data.get("id_macchina"),
        descrizione=data.get("descrizione"),
        tav_padre=tav_padre,
        stato=data.get("stato", "IN_ATTESA")
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
    lavorazione.descrizione = data.get("descrizione", lavorazione.descrizione)
    lavorazione.tav_padre   = data.get("tav_padre", lavorazione.tav_padre) or None
    lavorazione.stato       = data.get("stato", lavorazione.stato)
    db.session.commit()
    return jsonify({"messaggio": "Lavorazione aggiornata"}), 200

@app.route("/lavorazioni/<int:id>", methods=["DELETE"])
@jwt_required()
def elimina_lavorazione(id):
    lavorazione = Lavorazione.query.get(id)
    if not lavorazione:
        return jsonify({"errore": "Lavorazione non trovata"}), 404
    db.session.delete(lavorazione)
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
