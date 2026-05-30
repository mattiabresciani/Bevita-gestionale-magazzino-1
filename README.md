# Progetto Gestione Magazzino - BEVITA

Questo repository contiene il codice sorgente per l'applicazione di **Gestione Magazzino** del marchio **BEVITA**. Il progetto è strutturato con un frontend moderno in stile neumorfico 3D e un'architettura predisposta per l'integrazione con un database tramite API.

**Data Ultimo Aggiornamento:** 26 Maggio 2026

---

## 🚀 Funzionalità Implementate

### 1. Sistema di Autenticazione (Frontend Safe)
* **Pagina di Login (`login.html`):** Interfaccia utente pulita e reattiva con font *Poppins* integrato.
* **Validazione Locale Rigida:** Implementato un controllo di sicurezza nel modulo di login che accetta esclusivamente le credenziali:
  * **Username:** `test`
  * **Password:** `test`
* **Gestione degli Errori:** Inserito un sistema dinamico di feedback visivo che restituisce l'esatta stringa `"credenziali sbagliate"` in caso di inserimento errato, bloccando il reindirizzamento nativo non autorizzato.
* **Reindirizzamento Temporizzato:** In caso di successo, l'utente viene indirizzato alla dashboard principale dopo un delay di 1500ms.

### 2. Dashboard Principale (`index.html`)
* **Layout 3D & Sidebar:** Menu laterale a comparsa (Sidebar) con overlay scuro sullo sfondo, interamente gestito per l'apertura e la chiusura fluida tramite click o pressione della `×`.
* **Pulsanti a Pillola Dinamici:** Sistema di navigazione a tre schede (*Commesse*, *Macchine*, *Materie Prime*) con effetto tridimensionale attivo e aggiornamento in tempo reale del titolo della pagina.
* **Aggiornamento Asset Grafici:** Sostituiti e mappati correttamente tutti i riferimenti locali per il logo aziendale (`logoBevita.png`) e la favicon di navigazione (`faviconBevita.png`).

### 3. Menu a Tendina ad Albero (Sezione Commesse)
* **Visuale Speculare al Mockup:** Sviluppata una struttura ad albero espandibile per le card delle commesse.
* **Geometria dei Componenti:** Ogni riga di materiale all'interno della tendina è indipendente e strutturata secondo lo schema geometrico:
  `Segmento di Linea Verticale` -> *Stacco* -> `Quadratino Nero (■)` -> *Stacco* -> `Codice Materiale`.
* **Struttura Ciclabile per API:** Il codice HTML del frontend è stato ingegnerizzato in blocchi `tree-item` atomici. Questo permette alle API del database di moltiplicare automaticamente le righe in base ai materiali effettivamente presenti, mantenendo intatte le proporzioni e le spaziature CSS senza bisogno di toccare l'architettura.
* **Allineamento Quantità:** Il valore testuale della quantità è spinto e allineato dinamicamente sul margine destro della card.

---

## 📂 Struttura dei File

```text
├── index.html          # Dashboard principale e struttura tendina commesse
├── login.html          # Schermata di login con validazione locale
├── styles.css          # Fogli di stile generali e layout ad albero neumorfico
└── framework.js        # Logica di interazione (Sidebar, Pillole, Accordion)