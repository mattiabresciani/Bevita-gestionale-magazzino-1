<?php
// ── CONFIG + ACCESSO AL DB CON SQL ESPLICITO ──────────────────────────────────
// Port 1:1 degli helper Python q_all/q_one/q_scalar/q_exec (vedi backend/server.py).
// Le query restano in chiaro (SQL) ed eseguite con parametri legati (:nome) via PDO,
// così sono identiche a quelle del backend Flask e prevengono SQL injection.

declare(strict_types=1);

/**
 * Carica le variabili dal file .env condiviso col backend Python (backend/.env)
 * in un array. Niente dipendenze esterne: parser minimale KEY=VALUE.
 */
function carica_env(): array
{
    static $env = null;
    if ($env !== null) {
        return $env;
    }
    $env = [];
    // Riusa lo stesso .env del backend Flask, così i segreti vivono in un solo posto.
    $path = __DIR__ . '/../../backend/.env';
    if (is_file($path)) {
        foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $riga) {
            $riga = trim($riga);
            if ($riga === '' || str_starts_with($riga, '#') || !str_contains($riga, '=')) {
                continue;
            }
            [$k, $v] = explode('=', $riga, 2);
            $env[trim($k)] = trim($v);
        }
    }
    return $env;
}

/**
 * Connessione PDO (singleton). Traduce il SQLALCHEMY_DATABASE_URI in stile
 * mysql+pymysql://user:pass@host:port/db nel DSN PDO equivalente.
 */
function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $env = carica_env();
    $uri = $env['SQLALCHEMY_DATABASE_URI'] ?? '';
    // Esempio: mysql+pymysql://root:ServBay.dev@127.0.0.1:3306/bevitaap41283
    if (!preg_match('#^[^:]+://([^:]+):([^@]*)@([^:/]+)(?::(\d+))?/(.+)$#', $uri, $m)) {
        throw new RuntimeException('SQLALCHEMY_DATABASE_URI non valido o assente nel .env');
    }
    [, $user, $pass, $host, $port, $dbname] = $m;
    $port = $port ?: '3306';
    $dsn = "mysql:host=$host;port=$port;dbname=$dbname;charset=utf8mb4";
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        // Emulated prepares ON: come SQLAlchemy, consente di riusare lo stesso
        // placeholder :nome più volte nella stessa query (es. UNION con :idm due
        // volte in progresso_commessa). Le query restano parametrizzate (no injection).
        PDO::ATTR_EMULATE_PREPARES   => true,
    ]);
    return $pdo;
}

/** Esegue una SELECT e restituisce tutte le righe come array associativi. */
function q_all(string $sql, array $params = []): array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll();
}

/** Esegue una SELECT e restituisce la prima riga come array associativo (o null). */
function q_one(string $sql, array $params = []): ?array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

/** Esegue una SELECT che ritorna un singolo valore (es. COUNT). */
function q_scalar(string $sql, array $params = [])
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    $v = $stmt->fetchColumn();
    return $v === false ? null : $v;
}

/**
 * Esegue INSERT/UPDATE/DELETE. Ritorna lo statement (per rowCount) più
 * l'eventuale lastInsertId, in un piccolo oggetto compatibile con l'uso Python
 * (res.lastrowid -> ->lastrowid, res.rowcount -> ->rowcount).
 */
function q_exec(string $sql, array $params = []): object
{
    $pdo  = db();
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return (object) [
        'lastrowid' => (int) $pdo->lastInsertId(),
        'rowcount'  => $stmt->rowCount(),
    ];
}
