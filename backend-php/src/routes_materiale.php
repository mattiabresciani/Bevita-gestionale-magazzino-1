<?php
// ── ROTTE MATERIALE (catalogo magazzino) + LOGININFO ──────────────────────────
// Port di backend/server.py (sezioni Materiale e Logininfo).

declare(strict_types=1);

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;

return function (App $app): void {

    $app->get('/materiale', function (Request $request, Response $response): Response {
        jwt_required($request);
        $out = array_map(fn($m) => [
            'id'          => (int) $m['id'],
            'codice'      => $m['CodiceMateriale'],
            'descrizione' => $m['Descrizione'],
            'quantita'    => $m['Quantita'] !== null ? (int) $m['Quantita'] : null,
        ], q_all("SELECT id, CodiceMateriale, Descrizione, Quantita FROM materialeMagazzino"));
        return json($response, $out);
    });

    $app->post('/materiale', function (Request $request, Response $response): Response {
        jwt_required($request);
        $data = $request->getParsedBody();
        if (!$data) {
            return json($response, ['errore' => 'Dati mancanti'], 400);
        }
        $qty = $data['quantita'] ?? 0;
        if ($qty !== null && (float) $qty < 0) {
            return json($response, ['errore' => 'La quantità non può essere negativa'], 400);
        }
        $res = q_exec("INSERT INTO materialeMagazzino (CodiceMateriale, Descrizione, Quantita) VALUES (:c, :d, :q)",
            ['c' => $data['codice'] ?? null, 'd' => $data['descrizione'] ?? null, 'q' => $qty]);
        return json($response, ['messaggio' => 'Materiale aggiunto', 'id' => $res->lastrowid], 201);
    });

    $app->put('/materiale/{id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $mat = q_one("SELECT CodiceMateriale, Descrizione, Quantita FROM materialeMagazzino WHERE id = :id", ['id' => $id]);
        if (!$mat) {
            return json($response, ['errore' => 'Materiale non trovato'], 404);
        }
        $data = $request->getParsedBody() ?: [];
        $qty = $data['quantita'] ?? $mat['Quantita'];
        if ($qty !== null && (float) $qty < 0) {
            return json($response, ['errore' => 'La quantità non può essere negativa'], 400);
        }
        q_exec("UPDATE materialeMagazzino SET CodiceMateriale = :c, Descrizione = :d, Quantita = :q WHERE id = :id",
            ['c' => $data['codice'] ?? $mat['CodiceMateriale'], 'd' => $data['descrizione'] ?? $mat['Descrizione'],
             'q' => $qty, 'id' => $id]);
        return json($response, ['messaggio' => 'Materiale aggiornato']);
    });

    $app->delete('/materiale/{id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        if (!q_one("SELECT id FROM materialeMagazzino WHERE id = :id", ['id' => $id])) {
            return json($response, ['errore' => 'Materiale non trovato'], 404);
        }
        q_exec("DELETE FROM materialeMagazzino WHERE id = :id", ['id' => $id]);
        return json($response, ['messaggio' => 'Materiale eliminato']);
    });

    // ── LOGININFO (dati utente dal token) ───────────────────────────────────────
    $app->get('/logininfo', function (Request $request, Response $response): Response {
        $claims = jwt_required($request);
        return json($response, [
            'username' => $claims['sub'] ?? null,
            'ruolo'    => $claims['ruolo'] ?? '',
            'nome'     => $claims['nome'] ?? '',
        ]);
    });
};
