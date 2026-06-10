<?php
// ── PREPARAZIONE MATERIALI (scaffalatura) + MAPPA CELLE ───────────────────────
// Port di backend/server.py. fornisci/restituisci scalano il magazzino e scrivono
// le forniture in modo ATOMICO (transazione PDO), senza vincolo di sequenza.

declare(strict_types=1);

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;

return function (App $app): void {

    // ── FORNISCI (prepara una quantità dal magazzino) ───────────────────────────
    $app->post('/commessa-macchine/{cm_id}/materiale/{mat_id}/fornisci', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $cm_id  = (int) $args['cm_id'];
        $mat_id = (int) $args['mat_id'];
        $cm = q_one("SELECT id, id_macchina, quantita FROM commessa_macchine WHERE id = :id", ['id' => $cm_id]);
        if (!$cm) {
            return json($response, ['errore' => 'Commessa-macchina non trovata'], 404);
        }
        $data = $request->getParsedBody() ?: [];
        $richiesta = filter_var($data['quantita'] ?? 1, FILTER_VALIDATE_INT);
        if ($richiesta === false || $richiesta < 1) {
            return json($response, ['errore' => 'Quantità non valida'], 400);
        }

        $mat = q_one("SELECT id, Quantita FROM materialeMagazzino WHERE id = :id", ['id' => $mat_id]);
        if (!$mat) {
            return json($response, ['errore' => 'Materiale non trovato'], 404);
        }
        $stock = (int) ($mat['Quantita'] ?? 0);

        $richs = richmat_materiale_macchina((int) $cm['id_macchina'], $mat_id);
        if (!$richs) {
            return json($response, ['errore' => 'Questo materiale non è richiesto da questa macchina'], 400);
        }

        $assegnato = 0;
        db()->beginTransaction();
        try {
            foreach ($richs as $r) {
                if ($richiesta <= 0 || $stock <= 0) {
                    break;
                }
                $target = $r['quantita'] * $cm['quantita'];
                $f = q_one("SELECT id, quantita_fornita FROM fornitura_materiali " .
                    "WHERE id_commessa_macchina = :cm AND id_rich_mat = :rm", ['cm' => $cm['id'], 'rm' => $r['id']]);
                $forn = $f ? (int) $f['quantita_fornita'] : 0;
                $manca = $target - $forn;
                if ($manca <= 0) {
                    continue;
                }
                $manca = (int) ceil($manca);   // arrotonda per eccesso (come in Flask)
                $dai = min($manca, $richiesta, $stock);
                if ($dai <= 0) {
                    continue;
                }
                if ($f) {
                    q_exec("UPDATE fornitura_materiali SET quantita_fornita = quantita_fornita + :n WHERE id = :id",
                        ['n' => $dai, 'id' => $f['id']]);
                } else {
                    q_exec("INSERT INTO fornitura_materiali (id_commessa_macchina, id_rich_mat, quantita_fornita) " .
                        "VALUES (:cm, :rm, :n)", ['cm' => $cm['id'], 'rm' => $r['id'], 'n' => $dai]);
                }
                $assegnato += $dai;
                $richiesta -= $dai;
                $stock     -= $dai;
            }
            if ($assegnato) {
                q_exec("UPDATE materialeMagazzino SET Quantita = Quantita - :n WHERE id = :id",
                    ['n' => $assegnato, 'id' => $mat_id]);
            }
            db()->commit();
        } catch (\Throwable $e) {
            db()->rollBack();
            throw $e;
        }

        return json($response, ['messaggio' => 'Materiale assegnato', 'assegnato' => $assegnato, 'quantita_stock' => $stock]);
    });

    // ── RESTITUISCI (rimette una quantità in magazzino) ─────────────────────────
    $app->post('/commessa-macchine/{cm_id}/materiale/{mat_id}/restituisci', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $cm_id  = (int) $args['cm_id'];
        $mat_id = (int) $args['mat_id'];
        $cm = q_one("SELECT id, id_macchina FROM commessa_macchine WHERE id = :id", ['id' => $cm_id]);
        if (!$cm) {
            return json($response, ['errore' => 'Commessa-macchina non trovata'], 404);
        }
        $data = $request->getParsedBody() ?: [];
        $richiesta = filter_var($data['quantita'] ?? 1, FILTER_VALIDATE_INT);
        if ($richiesta === false || $richiesta < 1) {
            return json($response, ['errore' => 'Quantità non valida'], 400);
        }

        $richs = richmat_materiale_macchina((int) $cm['id_macchina'], $mat_id);
        $restituito = 0;
        db()->beginTransaction();
        try {
            foreach ($richs as $r) {
                if ($richiesta <= 0) {
                    break;
                }
                $f = q_one("SELECT id, quantita_fornita FROM fornitura_materiali " .
                    "WHERE id_commessa_macchina = :cm AND id_rich_mat = :rm", ['cm' => $cm['id'], 'rm' => $r['id']]);
                if (!$f || (int) $f['quantita_fornita'] <= 0) {
                    continue;
                }
                $togli = min((int) $f['quantita_fornita'], $richiesta);
                q_exec("UPDATE fornitura_materiali SET quantita_fornita = quantita_fornita - :n WHERE id = :id",
                    ['n' => $togli, 'id' => $f['id']]);
                $restituito += $togli;
                $richiesta  -= $togli;
            }
            if ($restituito) {
                q_exec("UPDATE materialeMagazzino SET Quantita = COALESCE(Quantita, 0) + :n WHERE id = :id",
                    ['n' => $restituito, 'id' => $mat_id]);
            }
            db()->commit();
        } catch (\Throwable $e) {
            db()->rollBack();
            throw $e;
        }

        $stock = (int) q_scalar("SELECT Quantita FROM materialeMagazzino WHERE id = :id", ['id' => $mat_id]);
        return json($response, ['messaggio' => 'Materiale restituito', 'restituito' => $restituito, 'quantita_stock' => $stock]);
    });

    // ── SCAFFALATURA (mappa cella → commessa) ───────────────────────────────────
    $app->get('/scaffale/celle', function (Request $request, Response $response): Response {
        jwt_required($request);
        $out = [];
        foreach (q_all(
            "SELECT s.cella, c.id, c.codice_commessa, c.descrizione, c.anno, c.stato_chiusura " .
            "FROM scaffale_celle s JOIN commesse c ON s.id_commessa = c.id") as $r) {
            $out[$r['cella']] = ['commessa' => commessa_per_scaffale($r)];
        }
        // oggetto vuoto, non array, se nessuna cella (come jsonify({}))
        return json($response, $out ?: new \stdClass());
    });

    $app->put('/scaffale/celle/{cella}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $cella = $args['cella'];
        $data = $request->getParsedBody() ?: [];
        $id_commessa = $data['id_commessa'] ?? null;
        if (!$id_commessa) {
            return json($response, ['errore' => 'id_commessa mancante'], 400);
        }
        $c = q_one("SELECT id, codice_commessa, descrizione, anno, stato_chiusura FROM commesse WHERE id = :id",
            ['id' => $id_commessa]);
        if (!$c) {
            return json($response, ['errore' => 'Commessa non trovata'], 404);
        }
        q_exec("INSERT INTO scaffale_celle (cella, id_commessa) VALUES (:cella, :idc) " .
            "ON DUPLICATE KEY UPDATE id_commessa = :idc", ['cella' => $cella, 'idc' => $id_commessa]);
        return json($response, ['commessa' => commessa_per_scaffale($c)]);
    });

    $app->delete('/scaffale/celle/{cella}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        q_exec("DELETE FROM scaffale_celle WHERE cella = :cella", ['cella' => $args['cella']]);
        return json($response, ['messaggio' => 'Cella svuotata']);
    });
};

/** Tutte le rich_mat di una macchina (sotto i processi o dirette) per un dato materiale. */
function richmat_materiale_macchina(int $id_macchina, int $id_materiale): array
{
    return q_all(
        "SELECT r.id, r.quantita FROM rich_mat r JOIN lavorazioni l ON r.id_lavorazione = l.id " .
        "WHERE l.id_macchina = :idm AND r.id_materiale = :mat " .
        "UNION ALL " .
        "SELECT r.id, r.quantita FROM rich_mat r " .
        "WHERE r.id_macchina = :idm AND r.id_lavorazione IS NULL AND r.id_materiale = :mat",
        ['idm' => $id_macchina, 'mat' => $id_materiale]);
}

/** Forma compatta della commessa usata dallo scaffale (stessi nomi del frontend). */
function commessa_per_scaffale(array $c): array
{
    return [
        'id'          => (int) $c['id'],
        'codice'      => $c['codice_commessa'],
        'descrizione' => $c['descrizione'],
        'anno'        => $c['anno'] !== null ? (int) $c['anno'] : null,
        'stato'       => $c['stato_chiusura'],
    ];
}
