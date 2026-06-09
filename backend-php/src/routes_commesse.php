<?php
// ── ROTTE COMMESSE + AVANZAMENTO ──────────────────────────────────────────────
// Port di backend/server.py (sezioni Commesse, albero commessa, conferma avanzamento).

declare(strict_types=1);

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;

return function (App $app): void {

    // ── COMMESSE ──────────────────────────────────────────────────────────────
    $app->get('/commesse', function (Request $request, Response $response): Response {
        jwt_required($request);
        $out = [];
        foreach (q_all("SELECT id, codice_commessa, id_cliente, descrizione, anno, data_consegna, stato_chiusura FROM commesse") as $c) {
            $out[] = [
                'id'            => (int) $c['id'],
                'codice'        => $c['codice_commessa'],
                'id_cliente'    => $c['id_cliente'] !== null ? (int) $c['id_cliente'] : null,
                'descrizione'   => $c['descrizione'],
                'anno'          => $c['anno'] !== null ? (int) $c['anno'] : null,
                'data_consegna' => $c['data_consegna'] ?: null,   // PDO ritorna già 'YYYY-MM-DD'
                'stato'         => $c['stato_chiusura'],
                'progresso'     => progresso_commessa((int) $c['id']),
            ];
        }
        return json($response, $out);
    });

    $app->post('/commesse', function (Request $request, Response $response): Response {
        jwt_required($request);
        $data = $request->getParsedBody();
        if (!$data) {
            return json($response, ['errore' => 'Dati mancanti'], 400);
        }
        $res = q_exec(
            "INSERT INTO commesse (codice_commessa, id_cliente, descrizione, anno, data_consegna, stato_chiusura) " .
            "VALUES (:cod, :cli, :descr, :anno, :data, :stato)",
            [
                'cod'   => $data['codice_commessa'] ?? null,
                'cli'   => $data['id_cliente'] ?? null,
                'descr' => $data['descrizione'] ?? null,
                'anno'  => $data['anno'] ?? null,
                'data'  => $data['data_consegna'] ?? null,
                'stato' => $data['stato_chiusura'] ?? 'APERTA',
            ]);
        return json($response, ['messaggio' => 'Commessa creata', 'id' => $res->lastrowid], 201);
    });

    $app->put('/commesse/{id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $c = q_one("SELECT * FROM commesse WHERE id = :id", ['id' => $id]);
        if (!$c) {
            return json($response, ['errore' => 'Commessa non trovata'], 404);
        }
        $data = $request->getParsedBody() ?: [];
        q_exec(
            "UPDATE commesse SET codice_commessa = :cod, id_cliente = :cli, descrizione = :descr, " .
            "anno = :anno, data_consegna = :data, stato_chiusura = :stato WHERE id = :id",
            [
                'cod'   => $data['codice_commessa'] ?? $c['codice_commessa'],
                'cli'   => $data['id_cliente'] ?? $c['id_cliente'],
                'descr' => $data['descrizione'] ?? $c['descrizione'],
                'anno'  => $data['anno'] ?? $c['anno'],
                'data'  => $data['data_consegna'] ?? $c['data_consegna'],
                'stato' => $data['stato_chiusura'] ?? $c['stato_chiusura'],
                'id'    => $id,
            ]);
        return json($response, ['messaggio' => 'Commessa aggiornata']);
    });

    $app->delete('/commesse/{id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        if (!q_one("SELECT id FROM commesse WHERE id = :id", ['id' => $id])) {
            return json($response, ['errore' => 'Commessa non trovata'], 404);
        }
        q_exec("DELETE FROM commesse WHERE id = :id", ['id' => $id]);
        return json($response, ['messaggio' => 'Commessa eliminata']);
    });

    // ── MACCHINE DI UNA COMMESSA ────────────────────────────────────────────────
    $app->get('/commesse/{id}/macchine', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $out = array_map(fn($e) => [
            'id'          => (int) $e['id_macchina'],
            'link_id'     => (int) $e['id'],
            'codice'      => $e['codice'],
            'descrizione' => $e['descrizione'],
            'quantita'    => (int) $e['quantita'],
            'stato'       => $e['stato'],
        ], q_all(
            "SELECT cm.id, cm.id_macchina, cm.quantita, cm.stato, m.codice, m.descrizione " .
            "FROM commessa_macchine cm JOIN macchine m ON cm.id_macchina = m.id " .
            "WHERE cm.id_commessa = :id", ['id' => $id]));
        return json($response, $out);
    });

    $app->post('/commesse/{id}/macchine', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $data = $request->getParsedBody();
        if (!$data || empty($data['id_macchina'])) {
            return json($response, ['errore' => 'id_macchina obbligatorio'], 400);
        }
        $res = q_exec(
            "INSERT INTO commessa_macchine (id_commessa, id_macchina, quantita, stato) " .
            "VALUES (:idc, :idm, :q, :stato)",
            [
                'idc'   => $id,
                'idm'   => $data['id_macchina'],
                'q'     => $data['quantita'] ?? 1,
                'stato' => $data['stato'] ?? 'DA_PRODURRE',
            ]);
        return json($response, ['messaggio' => 'Macchina aggiunta alla commessa', 'id' => $res->lastrowid], 201);
    });

    $app->delete('/commesse/{id}/macchine/{link_id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $link_id = (int) $args['link_id'];
        if (!q_one("SELECT id FROM commessa_macchine WHERE id = :lid AND id_commessa = :id", ['lid' => $link_id, 'id' => $id])) {
            return json($response, ['errore' => 'Associazione non trovata'], 404);
        }
        q_exec("DELETE FROM commessa_macchine WHERE id = :lid AND id_commessa = :id", ['lid' => $link_id, 'id' => $id]);
        return json($response, ['messaggio' => 'Macchina rimossa dalla commessa']);
    });

    // ── ALBERO OPERATIVO DELLA COMMESSA ─────────────────────────────────────────
    $app->get('/commesse/{id}/albero', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $commessa = q_one("SELECT id, codice_commessa, descrizione FROM commesse WHERE id = :id", ['id' => $id]);
        if (!$commessa) {
            return json($response, ['errore' => 'Commessa non trovata'], 404);
        }

        $macchine = [];
        foreach (q_all(
            "SELECT cm.id, cm.id_macchina, cm.quantita, cm.collassata, m.codice, m.descrizione " .
            "FROM commessa_macchine cm JOIN macchine m ON cm.id_macchina = m.id " .
            "WHERE cm.id_commessa = :id", ['id' => $id]) as $cm) {
            $conf = conferme_cm((int) $cm['id']);
            $lavs = [];
            foreach (q_all("SELECT id FROM lavorazioni WHERE id_macchina = :idm AND tav_padre IS NULL",
                ['idm' => $cm['id_macchina']]) as $lav) {
                $albero = build_albero_commessa($cm, (int) $lav['id'], true, [], $conf);
                if ($albero) {
                    $lavs[] = $albero;
                }
            }
            $macchine[] = [
                'commessa_macchina_id' => (int) $cm['id'],
                'id'                   => (int) $cm['id_macchina'],
                'codice'               => $cm['codice'],
                'descrizione'          => $cm['descrizione'],
                'quantita'             => (int) $cm['quantita'],
                'tipo'                 => 'macchina',
                'collassata'           => (bool) $cm['collassata'],
                'lavorazioni'          => $lavs,
                'materiali_diretti'    => serializza_richmat_diretti_commessa($cm, $conf),
            ];
        }

        return json($response, [
            'id'          => (int) $commessa['id'],
            'codice'      => $commessa['codice_commessa'],
            'descrizione' => $commessa['descrizione'],
            'tipo'        => 'commessa',
            'macchine'    => $macchine,
        ]);
    });

    // ── COLLASSA / RIAPRI MACCHINA-IN-COMMESSA ──────────────────────────────────
    $app->post('/commessa-macchine/{cm_id}/collassa', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $cm_id = (int) $args['cm_id'];
        if (!q_one("SELECT id FROM commessa_macchine WHERE id = :id", ['id' => $cm_id])) {
            return json($response, ['errore' => 'Commessa-macchina non trovata'], 404);
        }
        $data = $request->getParsedBody() ?: [];
        $val = !empty($data['collassata']) ? 1 : 0;
        q_exec("UPDATE commessa_macchine SET collassata = :v WHERE id = :id", ['v' => $val, 'id' => $cm_id]);
        return json($response, ['messaggio' => 'Stato aggiornato', 'collassata' => (bool) $val]);
    });

    // ── CONFERMA / ANNULLA AVANZAMENTO ──────────────────────────────────────────
    $app->post('/commessa-macchine/{cm_id}/conferma/{tipo}/{ref_id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $cm_id  = (int) $args['cm_id'];
        $tipo   = $args['tipo'];
        $ref_id = (int) $args['ref_id'];
        if (!in_array($tipo, ['rich_mat', 'lavorazione'], true)) {
            return json($response, ['errore' => 'Tipo non valido'], 400);
        }
        $cm = q_one("SELECT id, quantita FROM commessa_macchine WHERE id = :id", ['id' => $cm_id]);
        if (!$cm) {
            return json($response, ['errore' => 'Commessa-macchina non trovata'], 404);
        }
        // un materiale può essere confermato solo se è completo in scaffalatura
        if ($tipo === 'rich_mat') {
            $rm = q_one("SELECT quantita FROM rich_mat WHERE id = :r", ['r' => $ref_id]);
            $forn = q_scalar("SELECT quantita_fornita FROM fornitura_materiali " .
                "WHERE id_commessa_macchina = :cm AND id_rich_mat = :r", ['cm' => $cm_id, 'r' => $ref_id]) ?? 0;
            if ($rm && $forn < $rm['quantita'] * $cm['quantita']) {
                return json($response, ['errore' => 'Materiale non ancora completo in scaffalatura'], 400);
            }
        }
        if (!q_one("SELECT id FROM avanzamenti_confermati WHERE id_commessa_macchina = :cm AND tipo = :t AND ref_id = :r",
            ['cm' => $cm_id, 't' => $tipo, 'r' => $ref_id])) {
            q_exec("INSERT INTO avanzamenti_confermati (id_commessa_macchina, tipo, ref_id) VALUES (:cm, :t, :r)",
                ['cm' => $cm_id, 't' => $tipo, 'r' => $ref_id]);
        }
        return json($response, ['messaggio' => 'Avanzamento confermato']);
    });

    $app->delete('/commessa-macchine/{cm_id}/conferma/{tipo}/{ref_id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        q_exec("DELETE FROM avanzamenti_confermati WHERE id_commessa_macchina = :cm AND tipo = :t AND ref_id = :r",
            ['cm' => (int) $args['cm_id'], 't' => $args['tipo'], 'r' => (int) $args['ref_id']]);
        return json($response, ['messaggio' => 'Conferma annullata']);
    });
};
