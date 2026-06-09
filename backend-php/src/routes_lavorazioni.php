<?php
// ── ROTTE PROCESSI + LAVORAZIONI + RICH_MAT ───────────────────────────────────
// Port di backend/server.py (sezioni Processi, Lavorazioni, Rich Mat).

declare(strict_types=1);

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;

return function (App $app): void {

    // ── PROCESSI (catalogo condiviso) ───────────────────────────────────────────
    $app->get('/processi', function (Request $request, Response $response): Response {
        jwt_required($request);
        $out = array_map(fn($p) => ['id' => (int) $p['id'], 'descrizione' => $p['descrizione']],
            q_all("SELECT id, descrizione FROM processi_tipo"));
        return json($response, $out);
    });

    $app->post('/processi', function (Request $request, Response $response): Response {
        jwt_required($request);
        $data = $request->getParsedBody();
        if (!$data || empty($data['descrizione'])) {
            return json($response, ['errore' => 'descrizione obbligatoria'], 400);
        }
        $res = q_exec("INSERT INTO processi_tipo (descrizione) VALUES (:d)", ['d' => $data['descrizione']]);
        return json($response, ['messaggio' => 'Processo creato', 'id' => $res->lastrowid], 201);
    });

    $app->put('/processi/{id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $p = q_one("SELECT descrizione FROM processi_tipo WHERE id = :id", ['id' => $id]);
        if (!$p) {
            return json($response, ['errore' => 'Processo non trovato'], 404);
        }
        $data = $request->getParsedBody() ?: [];
        q_exec("UPDATE processi_tipo SET descrizione = :d WHERE id = :id",
            ['d' => $data['descrizione'] ?? $p['descrizione'], 'id' => $id]);
        return json($response, ['messaggio' => 'Processo aggiornato']);
    });

    $app->delete('/processi/{id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        if (!q_one("SELECT id FROM processi_tipo WHERE id = :id", ['id' => $id])) {
            return json($response, ['errore' => 'Processo non trovato'], 404);
        }
        $usi = (int) q_scalar("SELECT COUNT(*) FROM lavorazioni WHERE id_processo = :id", ['id' => $id]);
        if ($usi) {
            return json($response, ['errore' => "Processo usato da $usi macchina/e: rimuovilo prima da quelle."], 409);
        }
        q_exec("DELETE FROM processi_tipo WHERE id = :id", ['id' => $id]);
        return json($response, ['messaggio' => 'Processo eliminato']);
    });

    // ── LAVORAZIONI ─────────────────────────────────────────────────────────────
    $app->get('/lavorazioni', function (Request $request, Response $response): Response {
        jwt_required($request);
        $out = array_map(fn($l) => [
            'id'          => (int) $l['id'],
            'descrizione' => desc_processo($l),
            'id_processo' => $l['id_processo'] !== null ? (int) $l['id_processo'] : null,
            'id_macchina' => (int) $l['id_macchina'],
            'tav_padre'   => $l['tav_padre'] !== null ? (int) $l['tav_padre'] : null,
        ], q_all("SELECT id, id_macchina, id_processo, id_semilavorato, tav_padre FROM lavorazioni"));
        return json($response, $out);
    });

    $app->post('/lavorazioni', function (Request $request, Response $response): Response {
        jwt_required($request);
        $data = $request->getParsedBody();
        if (!$data || empty($data['id_macchina'])) {
            return json($response, ['errore' => 'id_macchina obbligatorio'], 400);
        }
        if (empty($data['id_processo'])) {
            return json($response, ['errore' => 'id_processo obbligatorio'], 400);
        }
        $tav_padre = $data['tav_padre'] ?? null ?: null;
        if ($tav_padre) {
            $padre = q_one("SELECT id_macchina FROM lavorazioni WHERE id = :id", ['id' => $tav_padre]);
            if (!$padre || (int) $padre['id_macchina'] !== (int) $data['id_macchina']) {
                return json($response, ['errore' => 'tav_padre non valido o appartiene ad altra macchina'], 400);
            }
        }
        $res = q_exec("INSERT INTO lavorazioni (id_macchina, id_processo, tav_padre) VALUES (:idm, :idp, :pad)",
            ['idm' => $data['id_macchina'], 'idp' => $data['id_processo'], 'pad' => $tav_padre]);
        return json($response, ['messaggio' => 'Lavorazione creata', 'id' => $res->lastrowid], 201);
    });

    $app->put('/lavorazioni/{id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $lav = q_one("SELECT id_processo, tav_padre FROM lavorazioni WHERE id = :id", ['id' => $id]);
        if (!$lav) {
            return json($response, ['errore' => 'Lavorazione non trovata'], 404);
        }
        $data = $request->getParsedBody() ?: [];
        $tav_padre = ($data['tav_padre'] ?? $lav['tav_padre']) ?: null;
        q_exec("UPDATE lavorazioni SET id_processo = :idp, tav_padre = :pad WHERE id = :id",
            ['idp' => $data['id_processo'] ?? $lav['id_processo'], 'pad' => $tav_padre, 'id' => $id]);
        return json($response, ['messaggio' => 'Lavorazione aggiornata']);
    });

    $app->delete('/lavorazioni/{id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        if (!q_one("SELECT id FROM lavorazioni WHERE id = :id", ['id' => $id])) {
            return json($response, ['errore' => 'Lavorazione non trovata'], 404);
        }
        db()->beginTransaction();
        try {
            elimina_lavorazione_ricorsiva($id);
            db()->commit();
        } catch (\Throwable $e) {
            db()->rollBack();
            throw $e;
        }
        return json($response, ['messaggio' => 'Lavorazione eliminata']);
    });

    // ── RICH_MAT (sotto un processo o diretto sulla macchina) ───────────────────
    $app->get('/lavorazioni/{id}/rich_mat', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $out = array_map(fn($r) => [
            'id'                => (int) $r['id'],
            'id_materiale'      => (int) $r['id_materiale'],
            'codice'            => $r['codice'],
            'descrizione'       => $r['descrizione'],
            'quantita_richiesta' => (float) $r['quantita'],
            'quantita_stock'    => $r['stock'],
        ], q_all(
            "SELECT r.id, r.id_materiale, r.quantita, " .
            "       m.CodiceMateriale AS codice, m.Descrizione AS descrizione, m.Quantita AS stock " .
            "FROM rich_mat r JOIN materialeMagazzino m ON r.id_materiale = m.id " .
            "WHERE r.id_lavorazione = :id", ['id' => $id]));
        return json($response, $out);
    });

    $app->post('/lavorazioni/{id}/rich_mat', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $data = $request->getParsedBody();
        if (!$data || empty($data['id_materiale'])) {
            return json($response, ['errore' => 'id_materiale obbligatorio'], 400);
        }
        $qty = (float) ($data['quantita'] ?? 1);
        if ($qty <= 0) {
            return json($response, ['errore' => 'Quantità deve essere maggiore di zero'], 400);
        }
        $res = q_exec("INSERT INTO rich_mat (id_lavorazione, id_materiale, quantita) VALUES (:lav, :mat, :q)",
            ['lav' => $id, 'mat' => $data['id_materiale'], 'q' => $qty]);
        return json($response, ['messaggio' => 'Materiale aggiunto', 'id' => $res->lastrowid], 201);
    });

    $app->post('/macchine/{id}/rich_mat', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        if (!q_one("SELECT id FROM macchine WHERE id = :id", ['id' => $id])) {
            return json($response, ['errore' => 'Macchina non trovata'], 404);
        }
        $data = $request->getParsedBody();
        if (!$data || empty($data['id_materiale'])) {
            return json($response, ['errore' => 'id_materiale obbligatorio'], 400);
        }
        $qty = (float) ($data['quantita'] ?? 1);
        if ($qty <= 0) {
            return json($response, ['errore' => 'Quantità deve essere maggiore di zero'], 400);
        }
        $res = q_exec("INSERT INTO rich_mat (id_macchina, id_materiale, quantita) VALUES (:idm, :mat, :q)",
            ['idm' => $id, 'mat' => $data['id_materiale'], 'q' => $qty]);
        return json($response, ['messaggio' => 'Materiale diretto aggiunto', 'id' => $res->lastrowid], 201);
    });

    $app->put('/rich_mat/{id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $r = q_one("SELECT id_materiale, quantita FROM rich_mat WHERE id = :id", ['id' => $id]);
        if (!$r) {
            return json($response, ['errore' => 'Richiesta non trovata'], 404);
        }
        $data = $request->getParsedBody() ?: [];
        $qty = $data['quantita'] ?? $r['quantita'];
        if ($qty !== null && (float) $qty <= 0) {
            return json($response, ['errore' => 'Quantità deve essere maggiore di zero'], 400);
        }
        q_exec("UPDATE rich_mat SET id_materiale = :mat, quantita = :q WHERE id = :id",
            ['mat' => $data['id_materiale'] ?? $r['id_materiale'], 'q' => $qty, 'id' => $id]);
        return json($response, ['messaggio' => 'Richiesta aggiornata']);
    });

    $app->delete('/rich_mat/{id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        if (!q_one("SELECT id FROM rich_mat WHERE id = :id", ['id' => $id])) {
            return json($response, ['errore' => 'Richiesta non trovata'], 404);
        }
        q_exec("DELETE FROM rich_mat WHERE id = :id", ['id' => $id]);
        return json($response, ['messaggio' => 'Richiesta eliminata']);
    });
};

/**
 * Elimina una lavorazione, i suoi sotto-processi e i materiali richiesti (ricorsivo).
 * Le forniture si cancellano in cascade sul DELETE delle rich_mat (FK ON DELETE CASCADE).
 * Da chiamare DENTRO una transazione (nessun commit qui).
 */
function elimina_lavorazione_ricorsiva(int $id_lav): void
{
    foreach (q_all("SELECT id FROM lavorazioni WHERE tav_padre = :id", ['id' => $id_lav]) as $sub) {
        elimina_lavorazione_ricorsiva((int) $sub['id']);
    }
    q_exec("DELETE FROM rich_mat WHERE id_lavorazione = :id", ['id' => $id_lav]);
    q_exec("DELETE FROM lavorazioni WHERE id = :id", ['id' => $id_lav]);
}
