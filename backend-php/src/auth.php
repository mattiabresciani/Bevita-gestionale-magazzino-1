<?php
// ── AUTENTICAZIONE JWT ────────────────────────────────────────────────────────
// Sostituisce flask-jwt-extended. Stessi claim del backend Flask:
//   sub    = identity (username)
//   ruolo  = "admin" | "dipendente"
//   nome / cognome (solo per i dipendenti)
// HS256 con la stessa JWT_SECRET_KEY del .env, scadenza 10 ore.

declare(strict_types=1);

use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Psr\Http\Message\ServerRequestInterface as Request;

function jwt_secret(): string
{
    $env = carica_env();
    $s = $env['JWT_SECRET_KEY'] ?? '';
    if ($s === '') {
        throw new RuntimeException('JWT_SECRET_KEY assente nel .env');
    }
    return $s;
}

/** Crea un access token con identity + claim aggiuntivi (equivale a create_access_token). */
function crea_token(string $identity, array $claim = []): string
{
    $now = time();
    $payload = array_merge([
        'sub' => $identity,
        'iat' => $now,
        'nbf' => $now,
        'exp' => $now + 10 * 3600,   // JWT_ACCESS_TOKEN_EXPIRES = 10h
        'type' => 'access',
    ], $claim);
    return JWT::encode($payload, jwt_secret(), 'HS256');
}

/**
 * Legge e verifica il Bearer token dalla richiesta. Ritorna i claim come array,
 * oppure null se assente/non valido.
 */
function leggi_token(Request $request): ?array
{
    $header = $request->getHeaderLine('Authorization');
    if (!preg_match('/Bearer\s+(.+)/i', $header, $m)) {
        return null;
    }
    try {
        $decoded = JWT::decode($m[1], new Key(jwt_secret(), 'HS256'));
        return (array) $decoded;
    } catch (\Throwable $e) {
        return null;
    }
}

/**
 * Richiede un token valido (equivale a @jwt_required). Su fallimento lancia
 * un'eccezione gestita dal router che risponde 401. Ritorna i claim.
 */
function jwt_required(Request $request): array
{
    $claim = leggi_token($request);
    if ($claim === null) {
        throw new HttpErrore(401, 'Token mancante o non valido');
    }
    return $claim;
}

/** Richiede ruolo admin (equivale a @admin_required). */
function admin_required(Request $request): array
{
    $claim = jwt_required($request);
    if (($claim['ruolo'] ?? null) !== 'admin') {
        throw new HttpErrore(403, 'Accesso negato: permessi insufficienti');
    }
    return $claim;
}

/** Eccezione HTTP con status code, intercettata dall'error handler. */
class HttpErrore extends \RuntimeException
{
    public int $status;
    public function __construct(int $status, string $messaggio)
    {
        parent::__construct($messaggio);
        $this->status = $status;
    }
}
