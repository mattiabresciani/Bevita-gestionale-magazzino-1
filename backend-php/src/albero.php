<?php
// ── HELPER ALBERO / AVANZAMENTO ───────────────────────────────────────────────
// Port 1:1 degli helper Python (backend/server.py). Costruiscono gli alberi
// catalogo/commessa, derivano gli stati delle lavorazioni e il progresso, ed
// espandono le ricette dei semilavorati. Logica pura su q_all/q_one/q_exec.

declare(strict_types=1);

/**
 * Etichetta di una lavorazione-istanza: nome del semilavorato se la produce,
 * altrimenti il processo-tipo. $lav è un array con id_semilavorato e id_processo.
 */
function desc_processo(array $lav): ?string
{
    if (!empty($lav['id_semilavorato'])) {
        $s = q_one("SELECT codice, descrizione FROM semilavorati WHERE id = :id", ['id' => $lav['id_semilavorato']]);
        if ($s) {
            return $s['descrizione'] ?: $s['codice'];
        }
    }
    if (!empty($lav['id_processo'])) {
        $p = q_one("SELECT descrizione FROM processi_tipo WHERE id = :id", ['id' => $lav['id_processo']]);
        if ($p) {
            return $p['descrizione'];
        }
    }
    return null;
}

/** Albero STRUTTURALE del catalogo (senza stato: lo stato è per commessa). */
function build_albero_lavorazione(int $id_lav, array $visitati): ?array
{
    if (in_array($id_lav, $visitati, true)) {
        return null;
    }
    $visitati[] = $id_lav;
    $lav = q_one("SELECT id, id_macchina, id_processo, id_semilavorato, tav_padre FROM lavorazioni WHERE id = :id",
        ['id' => $id_lav]);
    if (!$lav) {
        return null;
    }

    $materiali = array_map(fn($r) => [
        'id'                => (int) $r['id'],
        'id_materiale'      => (int) $r['id_materiale'],
        'codice'            => $r['codice'],
        'descrizione'       => $r['descrizione'],
        'quantita_richiesta' => (float) $r['quantita'],
        'quantita_stock'    => $r['stock'],
        'tipo'              => 'rich_mat',
    ], q_all(
        "SELECT r.id, r.id_materiale, r.quantita, " .
        "       m.CodiceMateriale AS codice, m.Descrizione AS descrizione, m.Quantita AS stock " .
        "FROM rich_mat r JOIN materialeMagazzino m ON r.id_materiale = m.id " .
        "WHERE r.id_lavorazione = :id", ['id' => $id_lav]));

    $figli = [];
    foreach (q_all("SELECT id FROM lavorazioni WHERE tav_padre = :id", ['id' => $id_lav]) as $sub) {
        $figlio = build_albero_lavorazione((int) $sub['id'], $visitati);
        if ($figlio) {
            $figli[] = $figlio;
        }
    }

    return [
        'id'           => (int) $lav['id'],
        'descrizione'  => desc_processo($lav),
        'tipo'         => 'lavorazione',
        'semilavorato' => (bool) $lav['id_semilavorato'],
        'rich_mat'     => $materiali,
        'figli'        => $figli,
    ];
}

/** Materiali attaccati direttamente alla macchina (senza processo) — vista catalogo. */
function serializza_richmat_diretti_catalogo(int $id_macchina): array
{
    return array_map(fn($r) => [
        'id'                => (int) $r['id'],
        'id_materiale'      => (int) $r['id_materiale'],
        'codice'            => $r['codice'],
        'descrizione'       => $r['descrizione'],
        'quantita_richiesta' => (float) $r['quantita'],
        'quantita_stock'    => $r['stock'],
        'tipo'              => 'rich_mat',
    ], q_all(
        "SELECT r.id, r.id_materiale, r.quantita, " .
        "       m.CodiceMateriale AS codice, m.Descrizione AS descrizione, m.Quantita AS stock " .
        "FROM rich_mat r JOIN materialeMagazzino m ON r.id_materiale = m.id " .
        "WHERE r.id_macchina = :idm AND r.id_lavorazione IS NULL", ['idm' => $id_macchina]));
}

/**
 * Stato DERIVATO di una lavorazione per una macchina-in-commessa. Considera
 * materiali diretti + semilavorati componenti (ricorsivo). Target di ogni
 * materiale = quantita richiesta × n° macchine in commessa.
 */
function stato_lavorazione_cm(int $cm_id, $cm_quantita, int $id_lav): string
{
    $completi = 0;
    $iniziati = 0;
    $totali   = 0;

    foreach (q_all(
        "SELECT r.quantita, COALESCE(f.quantita_fornita, 0) AS fornita " .
        "FROM rich_mat r " .
        "LEFT JOIN fornitura_materiali f ON f.id_rich_mat = r.id AND f.id_commessa_macchina = :cm " .
        "WHERE r.id_lavorazione = :lav", ['cm' => $cm_id, 'lav' => $id_lav]) as $r) {
        $totali++;
        $target = $r['quantita'] * $cm_quantita;
        if ($r['fornita'] >= $target) {
            $completi++;
        } elseif ($r['fornita'] > 0) {
            $iniziati++;
        }
    }

    foreach (q_all("SELECT id FROM lavorazioni WHERE tav_padre = :id AND id_semilavorato IS NOT NULL",
        ['id' => $id_lav]) as $f) {
        $totali++;
        $s = stato_lavorazione_cm($cm_id, $cm_quantita, (int) $f['id']);
        if ($s === 'COMPLETATA') {
            $completi++;
        } elseif ($s === 'IN_CORSO') {
            $iniziati++;
        }
    }

    if ($totali === 0) {
        return 'COMPLETATA';
    }
    if ($completi === $totali) {
        return 'COMPLETATA';
    }
    if ($completi > 0 || $iniziati > 0) {
        return 'IN_CORSO';
    }
    return 'IN_ATTESA';
}

/** Insieme delle conferme manuali per una macchina-in-commessa: set di "tipo:ref_id". */
function conferme_cm(int $cm_id): array
{
    $set = [];
    foreach (q_all("SELECT tipo, ref_id FROM avanzamenti_confermati WHERE id_commessa_macchina = :cm",
        ['cm' => $cm_id]) as $r) {
        $set[$r['tipo'] . ':' . $r['ref_id']] = true;
    }
    return $set;
}

/** Albero OPERATIVO per una macchina-in-commessa: stato derivato, forniture, lock sequenza. */
function build_albero_commessa(array $cm, int $id_lav, bool $padre_completo, array $visitati, array $conf): ?array
{
    if (in_array($id_lav, $visitati, true)) {
        return null;
    }
    $visitati[] = $id_lav;
    $lav = q_one("SELECT id, id_macchina, id_processo, id_semilavorato, tav_padre FROM lavorazioni WHERE id = :id",
        ['id' => $id_lav]);
    if (!$lav) {
        return null;
    }

    $stato = stato_lavorazione_cm((int) $cm['id'], $cm['quantita'], $id_lav);

    $materiali = array_map(fn($r) => [
        'rich_mat_id'       => (int) $r['id'],
        'id_materiale'      => (int) $r['id_materiale'],
        'codice'            => $r['codice'],
        'descrizione'       => $r['descrizione'],
        'quantita_richiesta' => (float) $r['quantita'],
        'target'            => (float) $r['quantita'] * $cm['quantita'],
        'quantita_fornita'  => (int) $r['fornita'],
        'quantita_stock'    => $r['stock'],
        'confermato'        => isset($conf['rich_mat:' . $r['id']]),
        'tipo'              => 'rich_mat',
    ], q_all(
        "SELECT r.id, r.id_materiale, r.quantita, " .
        "       m.CodiceMateriale AS codice, m.Descrizione AS descrizione, m.Quantita AS stock, " .
        "       COALESCE(f.quantita_fornita, 0) AS fornita " .
        "FROM rich_mat r " .
        "JOIN materialeMagazzino m ON r.id_materiale = m.id " .
        "LEFT JOIN fornitura_materiali f ON f.id_rich_mat = r.id AND f.id_commessa_macchina = :cm " .
        "WHERE r.id_lavorazione = :lav", ['cm' => $cm['id'], 'lav' => $id_lav]));

    $figli = [];
    $completa = ($stato === 'COMPLETATA');
    foreach (q_all("SELECT id FROM lavorazioni WHERE tav_padre = :id", ['id' => $id_lav]) as $sub) {
        $figlio = build_albero_commessa($cm, (int) $sub['id'], $completa, $visitati, $conf);
        if ($figlio) {
            $figli[] = $figlio;
        }
    }

    return [
        'id'          => (int) $lav['id'],
        'descrizione' => desc_processo($lav),
        'tipo'        => 'lavorazione',
        'stato'       => $stato,
        'confermato'  => isset($conf['lavorazione:' . $lav['id']]),
        // un semilavorato si produce dai suoi materiali a prescindere dalla sequenza → mai bloccato
        'bloccato'    => (!$padre_completo) && empty($lav['id_semilavorato']),
        'rich_mat'    => $materiali,
        'figli'       => $figli,
    ];
}

/** Materiali diretti della macchina (senza processo) — vista operativa commessa. */
function serializza_richmat_diretti_commessa(array $cm, array $conf): array
{
    return array_map(fn($r) => [
        'rich_mat_id'       => (int) $r['id'],
        'id_materiale'      => (int) $r['id_materiale'],
        'codice'            => $r['codice'],
        'descrizione'       => $r['descrizione'],
        'quantita_richiesta' => (float) $r['quantita'],
        'target'            => (float) $r['quantita'] * $cm['quantita'],
        'quantita_fornita'  => (int) $r['fornita'],
        'quantita_stock'    => $r['stock'],
        'confermato'        => isset($conf['rich_mat:' . $r['id']]),
        'tipo'              => 'rich_mat',
    ], q_all(
        "SELECT r.id, r.id_materiale, r.quantita, " .
        "       m.CodiceMateriale AS codice, m.Descrizione AS descrizione, m.Quantita AS stock, " .
        "       COALESCE(f.quantita_fornita, 0) AS fornita " .
        "FROM rich_mat r " .
        "JOIN materialeMagazzino m ON r.id_materiale = m.id " .
        "LEFT JOIN fornitura_materiali f ON f.id_rich_mat = r.id AND f.id_commessa_macchina = :cm " .
        "WHERE r.id_macchina = :idm AND r.id_lavorazione IS NULL", ['cm' => $cm['id'], 'idm' => $cm['id_macchina']]));
}

/** Percentuale di avanzamento: target dei materiali CONFERMATI / target totale. */
function progresso_commessa(int $id_commessa): int
{
    $forn = 0.0;
    $tot  = 0.0;
    foreach (q_all("SELECT id, id_macchina, quantita FROM commessa_macchine WHERE id_commessa = :idc",
        ['idc' => $id_commessa]) as $cm) {
        $conf = conferme_cm((int) $cm['id']);
        $richs = q_all(
            "SELECT r.id, r.quantita FROM rich_mat r " .
            "JOIN lavorazioni l ON r.id_lavorazione = l.id WHERE l.id_macchina = :idm " .
            "UNION ALL " .
            "SELECT r.id, r.quantita FROM rich_mat r " .
            "WHERE r.id_macchina = :idm AND r.id_lavorazione IS NULL", ['idm' => $cm['id_macchina']]);
        foreach ($richs as $r) {
            $target = $r['quantita'] * $cm['quantita'];
            $tot += $target;
            if (isset($conf['rich_mat:' . $r['id']])) {
                $forn += $target;
            }
        }
    }
    return $tot > 0 ? (int) round(100 * $forn / $tot) : 0;
}

/**
 * Istanzia la ricetta di un semilavorato come sotto-albero lavorazioni+materiali.
 * Ricorsivo con anti-ciclo. Gli INSERT restano nella transazione corrente
 * (nessun commit qui: lo fa l'endpoint chiamante).
 */
function espandi_semilavorato(int $id_sem, int $id_macchina, ?int $tav_padre, $mult, array $visitati): ?int
{
    if (in_array($id_sem, $visitati, true)) {
        return null;
    }
    $visitati[] = $id_sem;
    $s = q_one("SELECT id, id_processo FROM semilavorati WHERE id = :id", ['id' => $id_sem]);
    if (!$s) {
        return null;
    }
    $res = q_exec(
        "INSERT INTO lavorazioni (id_macchina, id_processo, id_semilavorato, tav_padre) " .
        "VALUES (:idm, :idp, :ids, :pad)",
        ['idm' => $id_macchina, 'idp' => $s['id_processo'], 'ids' => $s['id'], 'pad' => $tav_padre]);
    $new_lav_id = $res->lastrowid;
    foreach (q_all("SELECT id_materiale, id_semilavorato_comp, quantita FROM semilavorato_componenti WHERE id_semilavorato = :id",
        ['id' => $id_sem]) as $comp) {
        $q = ($comp['quantita'] ?: 1) * $mult;
        if ($comp['id_semilavorato_comp']) {
            espandi_semilavorato((int) $comp['id_semilavorato_comp'], $id_macchina, $new_lav_id, $q, $visitati);
        } elseif ($comp['id_materiale']) {
            q_exec("INSERT INTO rich_mat (id_lavorazione, id_materiale, quantita) VALUES (:lav, :mat, :q)",
                ['lav' => $new_lav_id, 'mat' => $comp['id_materiale'], 'q' => $q]);
        }
    }
    return $new_lav_id;
}
