<?php
// ── ENTRY POINT (Slim 4) ──────────────────────────────────────────────────────
// Port del backend Flask (backend/server.py). Questa è la PROVA end-to-end:
// login + CRUD clienti. Gli altri endpoint si aggiungono con lo stesso schema.

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;

$app = AppFactory::create();
$app->addBodyParsingMiddleware();

// ── CORS (sostituisce flask-cors: origins "*") ────────────────────────────────
$app->add(function (Request $request, $handler): Response {
    if ($request->getMethod() === 'OPTIONS') {
        $response = new \Slim\Psr7\Response();
    } else {
        $response = $handler->handle($request);
    }
    return $response
        ->withHeader('Access-Control-Allow-Origin', '*')
        ->withHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        ->withHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
});

// Risponde a tutte le preflight OPTIONS.
$app->options('/{routes:.+}', fn(Request $r, Response $resp) => $resp);

// ── Helper risposta JSON ──────────────────────────────────────────────────────
function json(Response $response, $data, int $status = 200): Response
{
    // JSON_PRESERVE_ZERO_FRACTION: 1.0 resta 1.0 (come i Float di Python/SQLAlchemy),
    // non viene appiattito a 1, così l'output combacia col backend Flask.
    $response->getBody()->write(json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION));
    return $response->withHeader('Content-Type', 'application/json')->withStatus($status);
}

// ── Error handler: traduce HttpErrore in JSON {errore: ...} col giusto status ──
$errorMiddleware = $app->addErrorMiddleware(true, true, true);
$errorMiddleware->setDefaultErrorHandler(function (Request $request, \Throwable $e) use ($app) {
    $status = $e instanceof HttpErrore ? $e->status : 500;
    $resp = $app->getResponseFactory()->createResponse();
    return json($resp, ['errore' => $e->getMessage()], $status);
});

// ── Logging delle scritture (equivale a @app.after_request) ────────────────────
$app->add(function (Request $request, $handler): Response {
    $response = $handler->handle($request);
    $metodo = $request->getMethod();
    if (in_array($metodo, ['POST', 'PUT', 'DELETE'], true)) {
        $path = $request->getUri()->getPath();
        if ($path === '/login') {
            $body = $request->getParsedBody() ?: [];
            $utente = $body['username'] ?? 'anonimo';
            $ruolo = '-';
        } else {
            $claim = leggi_token($request);
            $utente = $claim['sub'] ?? 'anonimo';
            $ruolo = $claim['ruolo'] ?? '-';
        }
        $esito = $response->getStatusCode() < 400 ? 'OK' : 'ERRORE(' . $response->getStatusCode() . ')';
        scrivi_log($utente, $ruolo, sezione_da_path($path), $metodo . ' ' . $path, $esito);
    }
    return $response;
});


// ── HOME (health check) ───────────────────────────────────────────────────────
$app->get('/', function (Request $request, Response $response): Response {
    return json($response, ['stato' => 'Server attivo e funzionante!']);
});


// ── LOGIN ─────────────────────────────────────────────────────────────────────
$app->post('/login', function (Request $request, Response $response): Response {
    $data = $request->getParsedBody();
    if (!$data) {
        return json($response, ['errore' => 'Dati mancanti'], 400);
    }
    $username = $data['username'] ?? null;
    $password = (string) ($data['password'] ?? '');

    $env = carica_env();
    $envUser = $env['ADMIN_USR'] ?? null;
    $envHash = $env['ADMIN_PASSWD'] ?? '';

    // password_verify gestisce nativamente gli hash bcrypt ($2b$/$2y$) già nel DB/.env.
    if ($username === $envUser && password_verify($password, $envHash)) {
        $token = crea_token($username, ['ruolo' => 'admin']);
        return json($response, ['token' => $token], 200);
    }

    $utente = q_one(
        "SELECT password, nome, cognome FROM utenti WHERE identificatore_login = :u AND ruolo = 'Dipendente'",
        ['u' => $username]
    );
    if ($utente && $utente['password'] && password_verify($password, $utente['password'])) {
        $token = crea_token($username, [
            'ruolo'   => 'dipendente',
            'nome'    => $utente['nome'] ?? '',
            'cognome' => $utente['cognome'] ?? '',
        ]);
        return json($response, ['token' => $token], 200);
    }

    return json($response, ['errore' => 'Credenziali Errate'], 401);
});


// ── CLIENTI ───────────────────────────────────────────────────────────────────
$app->get('/clienti', function (Request $request, Response $response): Response {
    jwt_required($request);
    $righe = array_map(fn($c) => [
        'id'           => (int) $c['id'],
        'nome_cliente' => $c['nome_cliente'],
        'partita_iva'  => $c['partita_iva'] ?? '',
    ], q_all("SELECT id, nome_cliente, partita_iva FROM clienti"));
    return json($response, $righe);
});

$app->post('/clienti', function (Request $request, Response $response): Response {
    jwt_required($request);
    $data = $request->getParsedBody();
    if (!$data || empty($data['nome_cliente'])) {
        return json($response, ['errore' => 'nome_cliente obbligatorio'], 400);
    }
    $res = q_exec("INSERT INTO clienti (nome_cliente, partita_iva) VALUES (:n, :p)",
        ['n' => $data['nome_cliente'], 'p' => $data['partita_iva'] ?? null]);
    return json($response, ['messaggio' => 'Cliente creato', 'id' => $res->lastrowid], 201);
});

$app->put('/clienti/{id}', function (Request $request, Response $response, array $args): Response {
    jwt_required($request);
    $id = (int) $args['id'];
    $cliente = q_one("SELECT id, nome_cliente, partita_iva FROM clienti WHERE id = :id", ['id' => $id]);
    if (!$cliente) {
        return json($response, ['errore' => 'Cliente non trovato'], 404);
    }
    $data = $request->getParsedBody() ?: [];
    q_exec("UPDATE clienti SET nome_cliente = :n, partita_iva = :p WHERE id = :id", [
        'n'  => $data['nome_cliente'] ?? $cliente['nome_cliente'],
        'p'  => $data['partita_iva'] ?? $cliente['partita_iva'],
        'id' => $id,
    ]);
    return json($response, ['messaggio' => 'Cliente aggiornato']);
});

$app->delete('/clienti/{id}', function (Request $request, Response $response, array $args): Response {
    jwt_required($request);
    $id = (int) $args['id'];
    if (!q_one("SELECT id FROM clienti WHERE id = :id", ['id' => $id])) {
        return json($response, ['errore' => 'Cliente non trovato'], 404);
    }
    q_exec("DELETE FROM clienti WHERE id = :id", ['id' => $id]);
    return json($response, ['messaggio' => 'Cliente eliminato']);
});


// ── ALTRE ROTTE (registrate da file dedicati) ─────────────────────────────────
(require __DIR__ . '/../src/routes_commesse.php')($app);
(require __DIR__ . '/../src/routes_macchine.php')($app);
(require __DIR__ . '/../src/routes_lavorazioni.php')($app);
(require __DIR__ . '/../src/routes_semilavorati.php')($app);
(require __DIR__ . '/../src/routes_materiale.php')($app);
(require __DIR__ . '/../src/routes_scaffale.php')($app);
(require __DIR__ . '/../src/routes_utenti.php')($app);


$app->run();
