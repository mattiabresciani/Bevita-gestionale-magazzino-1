<?php
// ── ROTTE MACCHINE (catalogo) + ALBERO + FILE ─────────────────────────────────
// Port di backend/server.py (sezione Macchine). Le immagini/schede tecniche stanno
// in Frontend/machineImg e Frontend/machineST, come nel backend Flask.

declare(strict_types=1);

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;

const MACHINE_IMG_DIR = __DIR__ . '/../../Frontend/machineImg';
const MACHINE_ST_DIR  = __DIR__ . '/../../Frontend/machineST';

return function (App $app): void {

    $app->get('/macchine', function (Request $request, Response $response): Response {
        jwt_required($request);
        $out = array_map(fn($m) => [
            'id'          => (int) $m['id'],
            'codice'      => $m['codice'],
            'descrizione' => $m['descrizione'],
        ], q_all("SELECT id, codice, descrizione FROM macchine"));
        return json($response, $out);
    });

    $app->post('/macchine', function (Request $request, Response $response): Response {
        jwt_required($request);
        $data = $request->getParsedBody();
        if (!$data) {
            return json($response, ['errore' => 'Dati mancanti'], 400);
        }
        $res = q_exec("INSERT INTO macchine (codice, descrizione) VALUES (:c, :d)",
            ['c' => $data['codice'] ?? null, 'd' => $data['descrizione'] ?? null]);
        return json($response, ['messaggio' => 'Macchina aggiunta al catalogo', 'id' => $res->lastrowid], 201);
    });

    $app->put('/macchine/{id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $m = q_one("SELECT codice, descrizione FROM macchine WHERE id = :id", ['id' => $id]);
        if (!$m) {
            return json($response, ['errore' => 'Macchina non trovata'], 404);
        }
        $data = $request->getParsedBody() ?: [];
        q_exec("UPDATE macchine SET codice = :c, descrizione = :d WHERE id = :id",
            ['c' => $data['codice'] ?? $m['codice'], 'd' => $data['descrizione'] ?? $m['descrizione'], 'id' => $id]);
        return json($response, ['messaggio' => 'Macchina aggiornata']);
    });

    $app->delete('/macchine/{id}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        if (!q_one("SELECT id FROM macchine WHERE id = :id", ['id' => $id])) {
            return json($response, ['errore' => 'Macchina non trovata'], 404);
        }
        q_exec("DELETE FROM macchine WHERE id = :id", ['id' => $id]);
        return json($response, ['messaggio' => 'Macchina eliminata']);
    });

    $app->get('/macchine/{id}/lavorazioni', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $out = array_map(fn($l) => [
            'id'          => (int) $l['id'],
            'descrizione' => desc_processo($l),
            'id_processo' => $l['id_processo'] !== null ? (int) $l['id_processo'] : null,
            'tav_padre'   => $l['tav_padre'] !== null ? (int) $l['tav_padre'] : null,
        ], q_all("SELECT id, id_macchina, id_processo, id_semilavorato, tav_padre FROM lavorazioni WHERE id_macchina = :id",
            ['id' => $id]));
        return json($response, $out);
    });

    $app->get('/macchine/{id}/albero', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $macchina = q_one("SELECT id, codice, descrizione FROM macchine WHERE id = :id", ['id' => $id]);
        if (!$macchina) {
            return json($response, ['errore' => 'Macchina non trovata'], 404);
        }
        $lavorazioni = [];
        foreach (q_all("SELECT id FROM lavorazioni WHERE id_macchina = :id AND tav_padre IS NULL", ['id' => $id]) as $lav) {
            $albero = build_albero_lavorazione((int) $lav['id'], []);
            if ($albero) {
                $lavorazioni[] = $albero;
            }
        }
        return json($response, [
            'id'                => (int) $macchina['id'],
            'codice'            => $macchina['codice'],
            'descrizione'       => $macchina['descrizione'],
            'tipo'              => 'macchina',
            'lavorazioni'       => $lavorazioni,
            'materiali_diretti' => serializza_richmat_diretti_catalogo($id),
        ]);
    });

    $app->get('/macchine/{id}/files', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        $id = (int) $args['id'];
        $macchina = q_one("SELECT codice FROM macchine WHERE id = :id", ['id' => $id]);
        if (!$macchina) {
            return json($response, ['errore' => 'Macchina non trovata'], 404);
        }
        $codice = $macchina['codice'];
        $immagine = null;
        foreach (['jpg', 'jpeg', 'png', 'webp'] as $ext) {
            if (is_file(MACHINE_IMG_DIR . "/$codice.$ext")) {
                $immagine = "$codice.$ext";
                break;
            }
        }
        $schede = [];
        if (is_dir(MACHINE_ST_DIR)) {
            $files = scandir(MACHINE_ST_DIR) ?: [];
            sort($files);
            foreach ($files as $f) {
                if (str_ends_with(strtolower($f), '.pdf') && (str_starts_with($f, $codice . '_') || $f === $codice . '.pdf')) {
                    $schede[] = $f;
                }
            }
        }
        return json($response, ['immagine' => $immagine, 'schede' => $schede]);
    });

    $app->get('/macchine/img/{filename}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        return servi_file($response, MACHINE_IMG_DIR . '/' . basename($args['filename']));
    });

    $app->get('/macchine/st/{filename}', function (Request $request, Response $response, array $args): Response {
        jwt_required($request);
        return servi_file($response, MACHINE_ST_DIR . '/' . basename($args['filename']), 'application/pdf');
    });
};

/** Streama un file dal disco (sostituisce send_file di Flask). */
function servi_file(Response $response, string $filepath, ?string $mime = null): Response
{
    if (!is_file($filepath)) {
        return json($response, ['errore' => 'File non trovato'], 404);
    }
    if ($mime === null) {
        $mime = match (strtolower(pathinfo($filepath, PATHINFO_EXTENSION))) {
            'jpg', 'jpeg' => 'image/jpeg',
            'png'         => 'image/png',
            'webp'        => 'image/webp',
            'pdf'         => 'application/pdf',
            default       => 'application/octet-stream',
        };
    }
    $response->getBody()->write((string) file_get_contents($filepath));
    return $response->withHeader('Content-Type', $mime);
}
