<?php
// ── LOG ATTIVITÀ ──────────────────────────────────────────────────────────────
// Port della logica Flask: registra in backend-php/log/AAAA-MM-GG.log chi/quando/
// sezione/azione/esito per le scritture (POST/PUT/DELETE). I file più vecchi di
// LOG_GIORNI vengono eliminati (al massimo una pulizia al giorno).

declare(strict_types=1);

const LOG_GIORNI = 15;

function log_dir(): string
{
    return __DIR__ . '/../log';
}

function pulisci_log_vecchi(): void
{
    $dir = log_dir();
    if (!is_dir($dir)) {
        return;
    }
    $limite = (new DateTime('today'))->modify('-' . LOG_GIORNI . ' days');
    foreach (scandir($dir) ?: [] as $nome) {
        if (!str_ends_with($nome, '.log')) {
            continue;
        }
        $data = DateTime::createFromFormat('Y-m-d', substr($nome, 0, -4));
        if ($data instanceof DateTime && $data < $limite) {
            @unlink($dir . '/' . $nome);
        }
    }
}

function scrivi_log(string $utente, string $ruolo, string $sezione, string $azione, string $esito): void
{
    static $ultima_pulizia = null;
    $dir = log_dir();
    @mkdir($dir, 0775, true);
    $oggi = date('Y-m-d');
    if ($ultima_pulizia !== $oggi) {
        pulisci_log_vecchi();
        $ultima_pulizia = $oggi;
    }
    $riga = sprintf(
        "%s | utente=%s (%s) | sezione=%s | azione=%s | esito=%s\n",
        date('Y-m-d H:i:s'), $utente, $ruolo, $sezione, $azione, $esito
    );
    @file_put_contents($dir . '/' . $oggi . '.log', $riga, FILE_APPEND);
}

/** Mappa il percorso della richiesta a una sezione leggibile (come in Flask). */
function sezione_da_path(string $path): string
{
    return match (true) {
        str_starts_with($path, '/login')             => 'Login',
        str_starts_with($path, '/commessa-macchine') => 'Produzione (commessa)',
        str_starts_with($path, '/commesse')          => 'Commesse',
        str_starts_with($path, '/macchine')          => 'Macchine',
        str_starts_with($path, '/processi'),
        str_starts_with($path, '/lavorazioni')       => 'Lavorazioni',
        str_starts_with($path, '/semilavorat')       => 'Semilavorati',
        str_starts_with($path, '/rich_mat')          => 'Materiali richiesti',
        str_starts_with($path, '/materiale')         => 'Materie Prime',
        str_starts_with($path, '/clienti')           => 'Clienti',
        str_starts_with($path, '/utenti')            => 'Utenti',
        str_starts_with($path, '/scaffale')          => 'Scaffalatura',
        default                                       => 'Altro',
    };
}
