# Riprogettazione del framework

**Stato:** Approvato dall'autore il 2026-11-11
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

Questo documento fissa la nuova direzione del framework ed è approvato per intero: le decisioni dell'autore e l'architettura che le realizza. Dove contraddice un altro documento della specifica, vale questo. Gli altri documenti vanno riscritti man mano che il lavoro procede (vedi «Documenti da riscrivere»).

## Perché

Il framework attuale è lento e non usa la capacità creativa del modello.

**Tempi misurati** (mediana per caso, da `testbench/results/`, su una campagna di prova piccola):

| Caso | Mediana | Massimo |
|---|---|---|
| Preparare una sessione | 6,5 min | 22–26 min |
| Dopo la sessione | 3,4 min | 8 min |
| Nuova campagna (un solo documento) | 1,7 min | 6,5 min |
| Linker su una sessione | 1,2 min | 5 min |
| Audit completo | 2,2 min | 7,5 min |

**Cause.**

- Un modello economico esegue a mano, un comando per turno, una procedura deterministica (il cablaggio di scrittura), attraverso quattro o cinque livelli annidati di skill che si passano rapporti di testo.
- Lo stesso modello economico scrive scene e schede. Il modello di alto livello fa solo smistamento.
- Inventare è vietato per default e, quando è permesso, è chiuso in limiti stretti (numero di scene, frasi per sezione, nessun luogo nuovo). Il documento del mondo è una parafrasi delle parole del master.
- Non esiste un processo che costruisca il mondo: luoghi, fazioni, storia ed eventi non si possono generare, e una scheda non si può creare da una descrizione.
- La coerenza è controllata solo dopo la scrittura, da un revisore che legge pochi documenti. Relazioni e cronologia stanno in prosa, quindi nessuno script le può usare.

## Decisioni dell'autore (2026-11-11)

1. **Obiettivo.** Il framework crea mondi narrativi coerenti con se stessi, completi di luoghi, personaggi ed eventi, partendo dagli adattatori dei sistemi di gioco e da descrizioni più o meno vaghe date dal master.
2. **Modifiche sostanziali ammesse.** Il framework è ancora embrionale: la struttura attuale si può sostituire, senza l'obbligo di un adattamento progressivo.
3. **Tutto il più automatico possibile.** Chi non sa nulla di intelligenza artificiale deve poterlo usare. Il master non sceglie modelli, livelli di costo o modalità: le scelte tecniche le fa il framework.
4. **La creatività è di Claude.** La scrittura creativa spetta a Claude. Codex, se presente, serve al più come fornitore di immagini. I modelli economici restano, per contenere il costo, ed eseguono ordini precisi dell'agente principale.
5. **Revisione proporzionata.** I controlli deterministici girano sempre. La revisione di un modello distinto avviene solo sui lotti che aggiungono fatti al canone. Questa decisione supera «Revisione indipendente sempre» dell'indice.
6. **Migrazione dopo l'aggiornamento.** Le campagne esistenti passano al nuovo formato con una migrazione post-update, reversibile con git e riprendibile.
7. **Fantasia sbloccata per default.** Il framework inventa ciò che le fonti non danno e dichiara al master che cosa ha inventato. La regola di provenienza (sezione 6) sostituisce il blocco della fantasia, i valori `IMAGINATION` e `PROPOSE`, la chiave `allow_model_imagination` e la domanda a quattro risposte. Restano fermi: la cronaca della serata riporta solo ciò che il master racconta, e la trascrizione del materiale importato è fedele alla fonte. Supera «Fantasia del modello, bloccata per default» dell'indice.
8. **L'intervista iniziale crea solo i file core.** La decisione dell'indice resta: l'intervista non genera un mondo iniziale. Il mondo si costruisce quando il master lo chiede.
9. **Organizzazione geografica confermata.** Resta la decisione del 2026-11-10: i documenti canonici stanno prima per categoria e poi per geografia.
10. **Dati delle regole dalla conoscenza del modello.** Statistiche, difficoltà, prezzi ed effetti si scrivono con la conoscenza del modello o con una sua ricerca, e lo schema dell'adattatore li valida. L'adattatore non contiene le tabelle delle regole del gioco. Una ricerca non riceve mai il blocco riservato del master. **Nota (Deciso (2026-11-14)):** due tabelle stanno nell'adattatore come eccezione a questa decisione: la tabella dei budget di difficoltà per livello e fascia e la tabella dal grado di sfida ai punti esperienza. Senza di esse il calcolo della difficoltà non è deterministico. Le altre regole del gioco restano fuori dall'adattatore. Dettagli in [Skill di libreria](Skill%20di%20libreria.md#l15-bilanciamento-degli-incontri).
11. **Il plugin per Codex si rimuove.** Il framework si distribuisce solo come plugin per Claude Code. Codex resta al più un fornitore di immagini, come dice la decisione 4.
12. **Provenienza per documento, modifiche a mano rispettate.** La provenienza si segna sul documento intero. Quando il framework trova in un documento modifiche che non ha fatto lui (per esempio fatte a mano dal master), le lascia come sono e avvisa il master in una frase.
13. **Abbozzi sempre salvati.** Ogni riga della scaletta che non viene espansa subito si salva nel canone come abbozzo.
14. **Piano geografico senza revisione di un modello.** Il piano geografico è un calcolo: lo verificano i controlli deterministici del motore. Un lotto che sposta soltanto documenti, senza aggiungere fatti, non ha la revisione di un modello. Modifica la decisione del 2026-11-10 che chiedeva la revisione indipendente del piano prima di ogni scrittura.
15. **Ripresa del lavoro dal contesto del motore.** Argomenti e handoff spariscono. Per riprendere il lavoro bastano il pacchetto di contesto del motore e una nota breve sul lavoro in corso, che il motore aggiorna a ogni salvataggio.
16. **La delega la decide il framework.** Quando far scrivere le schede ai modelli economici lo decide il framework, senza una soglia fissa nella specifica; la si tara con il testbench.
17. **Trascrizioni del feedback spente per default.** Si accendono solo in sviluppo o quando il master lo chiede. Modifica «Trascrizioni locali del feedback» dell'indice.

## Architettura

### 1. Ruoli e modelli

- **Autore.** L'agente principale, con il modello di alto livello, parla con il master e scrive mondo, schede e scene nella conversazione principale. Non esiste più un sub-agent che esegue il processo al suo posto.
- **Esecutori economici.** Ricevono dall'autore un ordine preciso e delimitato: espandere un abbozzo in una scheda completa a partire da un pacchetto di contesto, estrarre i fatti da un documento, giudicare un link ambiguo. Lavorano in parallelo su file diversi.
- **Revisore.** Un sub-agent distinto, lanciato una volta per lotto che aggiunge fatti, giudica solo ciò che uno script non può giudicare: contraddizioni di senso e segreti finiti nel testo pubblico.
- **Scelta automatica.** Quando delegare e a quale modello lo decide il framework in base alla dimensione del lavoro (decisione 16). Il master non vede né sceglie nulla.

### 2. Il motore

Un solo programma a riga di comando sostituisce il cablaggio di scrittura, il linker come skill e i controlli sparsi. L'autore lo chiama con una chiamata per operazione.

- `context`: dato ciò che si sta per scrivere (soggetti, luogo, sessione), restituisce un pacchetto di contesto compatto: il seme del mondo, i soggetti vicini nel grafo, la cronologia pertinente, i fili aperti e la nota sul lavoro in corso.
- `commit`: prende un lotto di bozze e, in un'unica transazione, valida formato e schema dell'adattatore, controlla il grafo, calcola e applica la collocazione geografica, risolve i link, aggiorna gli indici e la nota sul lavoro in corso, e salva la versione. Se qualcosa non va, non scrive nulla e restituisce gli errori in JSON.
- `check`: gli stessi controlli, senza scrivere.
- `query`: domande strutturate sul mondo (chi sta dove, chi è legato a chi, che cosa è successo prima di una data).

Gli errori meccanici (campo mancante, tabella malformata, link rotto, percorso geografico in conflitto) tornano all'autore dal motore, prima di ogni revisione. Il revisore non controlla il formato.

**Organizzazione geografica.** Resta la posizione canonica dei file (decisione 9). Il piano geografico è calcolato e verificato dal motore dentro `commit`, non più da una catena di passi eseguiti dal modello (decisione 14). Quando un lotto ha la revisione di un modello perché aggiunge fatti, il revisore riceve anche il piano.

**Modifiche a mano.** Prima di scrivere, `commit` confronta i documenti con l'ultima versione salvata dal framework. Un documento cambiato da qualcun altro non viene sovrascritto: il motore lo segnala all'autore, che lo lascia com'è e avvisa il master (decisione 12).

### 3. Il mondo come grafo

Il Markdown resta l'unica fonte di verità. I metadati in testa a ogni documento dichiarano i dati che gli script devono poter usare:

- il tipo del soggetto (luogo, personaggio, creatura, oggetto, fazione, evento);
- le relazioni con altri soggetti, con un tipo (appartenenza, parentela, alleanza, rivalità, dipendenza);
- il luogo e, per gli eventi, la data o la posizione nella cronologia;
- lo stato (per esempio vivo o morto, attivo o distrutto);
- la provenienza del documento (sezione 6) e, per un abbozzo, il fatto che lo è.

Dai documenti si deriva un indice con soggetti, relazioni, cronologia e fatti. È un derivato: si rigenera e non si modifica a mano. Su questo indice il motore controlla, senza alcun modello, i riferimenti a soggetti inesistenti, le date impossibili, un soggetto morto che agisce dopo la morte, un personaggio in due luoghi nello stesso momento.

I modelli di scheda si arricchiscono: motivazioni, legami, segreti e agganci di trama per i personaggi; abitanti, punti d'interesse e agganci per i luoghi. Si aggiungono i tipi fazione ed evento storico.

### 4. Il seme del mondo

Un documento sempre presente nel contesto dell'autore: genere, temi, conflitti centrali, fazioni, culture, convenzioni dei nomi, livello di potere, cose da evitare.

L'intervista resta quella dei soli file core (decisione 8), quindi il seme nasce piccolo: la premessa del master, il tono e il sistema di gioco. Cresce da solo. Ogni volta che il master aggiunge un'informazione sul mondo, o che il framework genera un pezzo di mondo, l'autore aggiorna il seme con ciò che vale per tutto il mondo (una nuova fazione, una convenzione dei nomi, un tema). Il master lo può correggere in qualunque momento parlando. Sostituisce la frase unica di descrizione in `campaign.yaml`.

### 5. Generazione a passate e abbozzi

Quando il master chiede molti contenuti insieme («crea la regione intorno al lago», «riempi il villaggio di personaggi»), l'autore lavora in tre passate:

1. **Scaletta.** Prima di scrivere le schede, l'autore scrive un elenco breve di tutto ciò che creerà: una riga per soggetto, con i legami già decisi. Per esempio: «Borgo Cenere: villaggio di minatori, lo governa Teodo Marr, è in lite con i pescatori del Lago Grigio»; «Teodo Marr: capo del borgo, debitore della gilda del sale». Decidere tutti i legami in un solo passaggio, su poche righe, è ciò che rende il lotto coerente.
2. **Espansione.** Le righe che servono subito diventano schede complete. Si scrivono in parallelo, anche da esecutori economici, ciascuna con la propria riga e il proprio pacchetto di contesto: nessuno deve inventare un legame, perché sono già tutti nella scaletta.
3. **Coerenza.** Un `commit` unico per il lotto: controlli del grafo, poi la revisione di un modello.

**Senza conferma.** In linea con la decisione 3, il master non approva la scaletta: il framework genera tutto, poi dice in poche frasi che cosa ha creato, e il master corregge parlando.

**Abbozzi.** Ogni riga della scaletta che non viene espansa subito si salva come abbozzo (decisione 13): un documento valido del canone, con nome, tipo, legami e una frase. Quando il master lo nomina o una sessione lo usa, viene espanso. Così un mondo può essere ampio ma poco costoso, e il dettaglio arriva dove si gioca.

Lo stesso percorso serve le richieste singole: «crea un oste burbero al Vecchio Mulino» è un lotto di un documento, senza scaletta.

### 6. Provenienza al posto del divieto

Ogni documento porta la sua provenienza: detto dal master, giocato al tavolo, generato dal framework (decisione 12). La regola è una sola: ciò che il master ha detto o che è stato giocato non si sovrascrive e non si contraddice; un documento generato si può rigenerare o cambiare liberamente, e il master viene avvisato in una frase di che cosa è nuovo.

Un documento generato che il master corregge a mano smette di essere rigenerabile: il framework rispetta le modifiche che non ha fatto lui, le lascia come sono e ne avvisa il master.

Un'invenzione non si presenta mai come citazione di una fonte, e un segreto inventato sta solo nel blocco riservato.

### 7. Adattatori come schema

L'adattatore dichiara la forma delle schede del suo sistema: campi obbligatori e facoltativi delle creature, campi meccanici degli oggetti, scala delle difficoltà, risorse, condizioni, ciò che l'agente non decide al posto del master. Non contiene le tabelle delle regole del gioco (decisione 10).

L'autore scrive statistiche, difficoltà, prezzi ed effetti con la propria conoscenza del sistema o con una ricerca, e il motore li valida contro lo schema: campi presenti, valori nel formato giusto, aritmetica coerente (per esempio modificatori ricavati dai punteggi). Una descrizione vaga («un capo bandito tosto per un gruppo di terzo livello») diventa così una scheda completa e verificata nella forma.

Senza adattatore, le difficoltà e i valori restano in parole, come oggi.

### 8. Processi

I processi diventano intenti riconosciuti dall'autore, descritti da skill brevi (obiettivo, vincoli, contratto di formato) e non da procedure passo per passo:

- creare la campagna (intervista dei soli file core);
- costruire o ampliare il mondo, su richiesta del master;
- creare o cambiare qualunque documento da una descrizione;
- preparare una sessione;
- dopo la sessione: scrivere la cronaca e proporre e applicare le conseguenze su schede, fazioni e cronologia;
- rispondere a una domanda sul mondo;
- portare dentro materiale esistente;
- tornare a una versione precedente.

### 9. Che cosa si elimina e che cosa si riusa

| Si elimina | Si riusa |
|---|---|
| Il runner dei processi, gli argomenti e gli handoff | La scansione delle menzioni e la verifica dei link |
| Il cablaggio di scrittura come skill, i rapporti di testo fra skill | L'indice dei soggetti, le librerie per metadati e YAML |
| Il protocollo di feedback per skill nel percorso normale | Le versioni con git e il «torna a com'era» |
| Il revisore dei link su ogni proposta | Il blocco riservato al master e i suoi controlli |
| La catena di passi del piano geografico eseguita dal modello | Il calcolo della collocazione geografica, dentro `commit` |
| Le skill procedurali di centinaia di righe | L'estrazione dei fatti dell'audit, che alimenta l'indice |
| Il plugin per Codex e le istruzioni di ripiego per Codex | Il caricamento dell'adattatore, le campagne di prova |

### 10. Migrazione

Una migrazione post-update porta le campagne esistenti al nuovo formato: aggiunge ai documenti i metadati di tipo e provenienza (tutto il contenuto esistente è «detto dal master»), ricava le relazioni che si possono leggere con certezza e lascia in sospeso le altre, costruisce l'indice e il primo seme del mondo dalla configurazione e dal documento del mondo. Toglie da `campaign.yaml` la chiave `allow_model_imagination` e sostituisce argomenti e handoff con la nota sul lavoro in corso. Non riscrive la prosa. È reversibile con git e si può riprendere dopo un'interruzione.

### 11. Misura

- **Tempo come criterio.** Ogni caso di prova ha un tempo massimo e un numero massimo di chiamate; superarli è un fallimento. Obiettivi iniziali, da verificare: una scheda sotto il minuto, una sessione in due o tre minuti, una regione di una trentina di soggetti in cinque-dieci minuti.
- **Casi di generazione.** Da un seme con vincoli seminati, il mondo generato deve rispettarli: si verifica sul grafo, senza leggere la chiave.
- **Qualità.** Una griglia per il contenuto creativo (specifico, giocabile, coerente con il seme), giudicata da un modello distinto.
- **Delega.** Il testbench misura tempi e costi con e senza esecutori economici, per tarare quando il framework delega (decisione 16).
- **Solo Claude.** Con la rimozione del plugin per Codex, il testbench misura solo Claude.

## Decisioni dell'indice toccate

| Decisione dell'indice | Effetto |
|---|---|
| Revisione indipendente sempre | Superata dalla decisione 5 |
| Fantasia del modello, bloccata per default | Superata dalla decisione 7 |
| Più agenti, con ruoli distinti (esecuzione a modelli economici) | Modificata dalla decisione 4: la scrittura creativa è dell'agente principale |
| Skill robuste (istruzioni che funzionano anche con Codex) | Modificata dalle decisioni 4 e 11: Codex esce dal framework |
| Il pacchetto è un plugin per Claude Code e per Codex | Superata dalla decisione 11 |
| Codex è facoltativo | Ridotta dalla decisione 11 a fornitore di immagini facoltativo |
| L'intervista iniziale crea solo i file core | Confermata dalla decisione 8 |
| Organizzazione geografica | Confermata dalla decisione 9; la revisione del piano è sostituita dai controlli del motore (decisione 14) |
| Trascrizioni locali del feedback | Modificata dalla decisione 17: spente per default |
| Sessioni gestite dal framework | L'obiettivo resta; argomenti e handoff sono sostituiti dalla decisione 15 |

## Documenti da riscrivere

Principi, Architettura, Orchestrazione degli agenti, Processi di core, Skill di libreria, Formato dei contenuti, Sistemi di gioco e stili, Configurazione, Robustezza e test, Gestione delle sessioni, Installazione e requisiti, Integrazioni esterne, Feedback d'uso. Fino alla riscrittura restano come descrizione del framework attuale.

## Piano di lavoro

1. **Formato e indice.** Metadati di tipo, relazioni, cronologia, provenienza e abbozzi; indice derivato; controlli del grafo.
2. **Motore.** `context`, `commit` (con la collocazione geografica, il rilevamento delle modifiche a mano e la nota sul lavoro in corso), `check`, `query`, con i loro test.
3. **Seme e generazione.** Seme del mondo che cresce, scaletta, espansione in lotto, abbozzi, revisione di coerenza.
4. **Adattatore come schema.** Validazione di forma e aritmetica per D&D 2024.
5. **Processi.** Campagna, mondo, documento singolo, sessione, dopo la sessione con le conseguenze, domande, import.
6. **Migrazione** delle campagne esistenti.
7. **Rimozione di Codex.** Plugin, istruzioni di ripiego, opzioni del testbench.
8. **Testbench.** Tempi massimi, casi di generazione, griglia di qualità, taratura della delega.
