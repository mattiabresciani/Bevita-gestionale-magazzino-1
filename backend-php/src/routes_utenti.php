<?php
// ── ROTTE UTENTI (solo admin) ─────────────────────────────────────────────────
// Port di backend/server.py. Le password sono hashate con bcrypt cost 12
// (password_hash genera $2y$12$, compatibile con gli hash $2b$ già nel DB).

declare(strict_types=1);

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;

return function (App $app): void {

    $app->get('/utenti', function (Request $request, Response $response): Response {
        admin_required($request);
        $out = array_map(fn($u) => [
            'id'                   => (int) $u['id'],
            'identificatore_login' => $u['identificatore_login'],
            'nome'                 => $u['nome'] ?? '',
            'cognome'              => $u['cognome'] ?? '',
            'ruolo'                => $u['ruolo'],
        ], q_all("SELECT id, identificatore_login, nome, cognome, ruolo FROM utenti WHERE ruolo = 'Dipendente'"));
        return json($response, $out);
    });

    $app->post('/utenti', function (Request $request, Response $response): Response {
        admin_required($request);
        $data = $request->getParsedBody();
        if (!$data) {
            return json($response, ['errore' => 'Dati mancanti'], 400);
        }
        $identificatore = trim($data['identificatore_login'] ?? '');
        $password = $data['password'] ?? '';
        if ($identificatore === '' || $password === '') {
            return json($response, ['errore' => 'identificatore_login e password sono obbligatori'], 400);
        }
        if (q_one("SELECT id FROM utenti WHERE identificatore_login = :i", ['i' => $identificatore])) {
            return json($response, ['errore' => 'Identificatore già in uso'], 409);
        }
        $res = q_exec(
            "INSERT INTO utenti (identificatore_login, password, nome, cognome, ruolo) " .
            "VALUES (:i, :p, :n, :c, 'Dipendente')",
            [
                'i' => $identificatore,
                'p' => password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]),
                'n' => trim($data['nome'] ?? ''),
                'c' => trim($data['cognome'] ?? ''),
            ]);
        return json($response, ['messaggio' => 'Utente creato', 'id' => $res->lastrowid], 201);
    });

    $app->put('/utenti/{id}/password', function (Request $request, Response $response, array $args): Response {
        admin_required($request);
        $id = (int) $args['id'];
        if (!q_one("SELECT id FROM utenti WHERE id = :id", ['id' => $id])) {
            return json($response, ['errore' => 'Utente non trovato'], 404);
        }
        $data = $request->getParsedBody() ?: [];
        $nuova = $data['password'] ?? '';
        if ($nuova === '') {
            return json($response, ['errore' => 'Password mancante'], 400);
        }
        q_exec("UPDATE utenti SET password = :p WHERE id = :id",
            ['p' => password_hash($nuova, PASSWORD_BCRYPT, ['cost' => 12]), 'id' => $id]);
        return json($response, ['messaggio' => 'Password aggiornata']);
    });

    $app->delete('/utenti/{id}', function (Request $request, Response $response, array $args): Response {
        admin_required($request);
        $id = (int) $args['id'];
        if (!q_one("SELECT id FROM utenti WHERE id = :id", ['id' => $id])) {
            return json($response, ['errore' => 'Utente non trovato'], 404);
        }
        q_exec("DELETE FROM utenti WHERE id = :id", ['id' => $id]);
        return json($response, ['messaggio' => 'Utente eliminato']);
    });
};
