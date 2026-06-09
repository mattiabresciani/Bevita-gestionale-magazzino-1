<?php
// ── ROTTE SEMILAVORATI (catalogo: lavorazione + componenti) ───────────────────
// Port di backend/server.py. L'aggiunta a macchina/lavorazione ESPANDE la ricetta
// in un sotto-albero (espandi_semilavorato) dentro una transazione.

declare(strict_types=1);

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;

return function (App $app): void {

    $app->get('/semilavorati', function (Request $request, Response $response): Response {
        jwt_required($request);
        $out = array_map(fn($s) => [
            'id'          => (int) $s['id'],
            'codice'      => $s['codice'],
            'descrizione' => $s['descrizione'],
            'id_processo' => $s['id_processo'] !== null ? (int) $s['id_processo'] : null,
            'processo'    => $s['processo'],
        ], q_all(
            "SELECT s.id, s.codice, s.descrizione, s.id_processo, p.descrizione AS processo " .
            "FROM semilavorati s LEFT JOIN processi_tipo p ON s.id_processo = p.id"));
        return json($response, $out);
    });

    $app->post('/semilavorati', function (Request $request, Response $response): Response {
        jwt_required($request);
        $data = $request->getParsedBody();
        if (!$data || empty($data['descrizione'])) {
            return json($response, ['errore' => 'descrizione obbligatoria'], 400);
        }
        $res = q_exec("INSERT INTO semilavorati (codice, descrizione, id_processo) VALUES (:c, :d, :p)",
            ['c' => $data['codice'] ?? null, 'd' => $data['descrizione'], 'p' => ($data['id_processo'] ?? null) ?: null]);
        return json($response, ['messaggio' => 'Semilavorato creato', 'id' => $res->lastrowid], 201);
    });

    $app->put('/semilavorati/{id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $s = q_one("SELECT codice, descrizione, id_processo FROM semilavorati WHERE id = :id", ['id' => $id]);
        if (!$s) {
            return json($response, ['errore' => 'Semilavorato non trovato'], 404);
        }
        $data = $request->getParsedBody() ?: [];
        $id_processo = array_key_exists('id_processo', $data) ? (($data['id_processo'] ?: null)) : $s['id_processo'];
        q_exec("UPDATE semilavorati SET codice = :c, descrizione = :d, id_processo = :p WHERE id = :id",
            ['c' => $data['codice'] ?? $s['codice'], 'd' => $data['descrizione'] ?? $s['descrizione'],
             'p' => $id_processo, 'id' => $id]);
        return json($response, ['messaggio' => 'Semilavorato aggiornato']);
    });

    $app->delete('/semilavorati/{id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        if (!q_one("SELECT id FROM semilavorati WHERE id = :id", ['id' => $id])) {
            return json($response, ['errore' => 'Semilavorato non trovato'], 404);
        }
        $usi_lav  = (int) q_scalar("SELECT COUNT(*) FROM lavorazioni WHERE id_semilavorato = :id", ['id' => $id]);
        $usi_comp = (int) q_scalar("SELECT COUNT(*) FROM semilavorato_componenti WHERE id_semilavorato_comp = :id", ['id' => $id]);
        if ($usi_lav || $usi_comp) {
            return json($response, ['errore' => 'Semilavorato in uso (in macchine o in altre ricette): rimuovilo prima da lì.'], 409);
        }
        db()->beginTransaction();
        try {
            q_exec("DELETE FROM semilavorato_componenti WHERE id_semilavorato = :id", ['id' => $id]);
            q_exec("DELETE FROM semilavorati WHERE id = :id", ['id' => $id]);
            db()->commit();
        } catch (\Throwable $e) {
            db()->rollBack();
            throw $e;
        }
        return json($response, ['messaggio' => 'Semilavorato eliminato']);
    });

    $app->get('/semilavorati/{id}/componenti', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $out = [];
        foreach (q_all("SELECT id, id_materiale, id_semilavorato_comp, quantita FROM semilavorato_componenti WHERE id_semilavorato = :id",
            ['id' => $id]) as $comp) {
            if ($comp['id_semilavorato_comp']) {
                $sc = q_one("SELECT codice, descrizione FROM semilavorati WHERE id = :id", ['id' => $comp['id_semilavorato_comp']]);
                $out[] = [
                    'id' => (int) $comp['id'], 'tipo' => 'semilavorato', 'rif_id' => (int) $comp['id_semilavorato_comp'],
                    'codice' => $sc['codice'] ?? null, 'descrizione' => $sc['descrizione'] ?? null,
                    'quantita' => (float) $comp['quantita'],
                ];
            } else {
                $mat = q_one("SELECT CodiceMateriale, Descrizione FROM materialeMagazzino WHERE id = :id", ['id' => $comp['id_materiale']]);
                $out[] = [
                    'id' => (int) $comp['id'], 'tipo' => 'materiale', 'rif_id' => (int) $comp['id_materiale'],
                    'codice' => $mat['CodiceMateriale'] ?? null, 'descrizione' => $mat['Descrizione'] ?? null,
                    'quantita' => (float) $comp['quantita'],
                ];
            }
        }
        return json($response, $out);
    });

    $app->post('/semilavorati/{id}/componenti', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        if (!q_one("SELECT id FROM semilavorati WHERE id = :id", ['id' => $id])) {
            return json($response, ['errore' => 'Semilavorato non trovato'], 404);
        }
        $data = $request->getParsedBody() ?: [];
        $qty = (float) ($data['quantita'] ?? 1);
        if ($qty <= 0) {
            return json($response, ['errore' => 'Quantità deve essere maggiore di zero'], 400);
        }
        $id_mat = $data['id_materiale'] ?? null;
        $id_sem = $data['id_semilavorato_comp'] ?? null;
        if (!$id_mat && !$id_sem) {
            return json($response, ['errore' => 'Specifica un materiale o un semilavorato'], 400);
        }
        if ($id_sem && (int) $id_sem === $id) {
            return json($response, ['errore' => 'Un semilavorato non può contenere se stesso'], 400);
        }
        $res = q_exec(
            "INSERT INTO semilavorato_componenti (id_semilavorato, id_materiale, id_semilavorato_comp, quantita) " .
            "VALUES (:s, :mat, :sc, :q)",
            ['s' => $id, 'mat' => $id_mat ?: null, 'sc' => $id_sem ?: null, 'q' => $qty]);
        return json($response, ['messaggio' => 'Componente aggiunto', 'id' => $res->lastrowid], 201);
    });

    $app->delete('/semilavorato_componenti/{id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        if (!q_one("SELECT id FROM semilavorato_componenti WHERE id = :id", ['id' => $id])) {
            return json($response, ['errore' => 'Componente non trovato'], 404);
        }
        q_exec("DELETE FROM semilavorato_componenti WHERE id = :id", ['id' => $id]);
        return json($response, ['messaggio' => 'Componente rimosso']);
    });

    // ── ESPANSIONE su lavorazione / macchina (istanzia la ricetta) ──────────────
    $app->post('/lavorazioni/{id}/semilavorato', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $lav = q_one("SELECT id, id_macchina FROM lavorazioni WHERE id = :id", ['id' => $id]);
        if (!$lav) {
            return json($response, ['errore' => 'Lavorazione non trovata'], 404);
        }
        $data = $request->getParsedBody() ?: [];
        if (empty($data['id_semilavorato'])) {
            return json($response, ['errore' => 'id_semilavorato obbligatorio'], 400);
        }
        $qty = (float) ($data['quantita'] ?? 1);
        db()->beginTransaction();
        try {
            espandi_semilavorato((int) $data['id_semilavorato'], (int) $lav['id_macchina'], (int) $lav['id'], $qty, []);
            db()->commit();
        } catch (\Throwable $e) {
            db()->rollBack();
            throw $e;
        }
        return json($response, ['messaggio' => 'Semilavorato aggiunto'], 201);
    });

    $app->post('/macchine/{id}/semilavorato', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        if (!q_one("SELECT id FROM macchine WHERE id = :id", ['id' => $id])) {
            return json($response, ['errore' => 'Macchina non trovata'], 404);
        }
        $data = $request->getParsedBody() ?: [];
        if (empty($data['id_semilavorato'])) {
            return json($response, ['errore' => 'id_semilavorato obbligatorio'], 400);
        }
        $qty = (float) ($data['quantita'] ?? 1);
        db()->beginTransaction();
        try {
            espandi_semilavorato((int) $data['id_semilavorato'], $id, null, $qty, []);
            db()->commit();
        } catch (\Throwable $e) {
            db()->rollBack();
            throw $e;
        }
        return json($response, ['messaggio' => 'Semilavorato aggiunto'], 201);
    });
};
