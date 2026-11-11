# Riprogettazione del framework

**Stato:** decisioni dell'autore del 2026-11-11, più una **Proposta** di architettura da approvare
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

Questo documento fissa la nuova direzione del framework. La sezione «Decisioni dell'autore» è vincolante. Tutto il resto è **Proposta**: descrive come realizzare quelle decisioni e non vale finché l'autore non lo approva. Dove questo documento contraddice un altro documento della specifica, per le decisioni vale questo; gli altri documenti vanno riscritti man mano che il lavoro procede (vedi «Documenti da riscrivere»).

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
4. **La creatività è di Claude.** La scrittura creativa spetta a Claude. Codex, se presente, serve al più come adattatore per la generazione di immagini. I modelli economici restano, per contenere il costo, ed eseguono ordini precisi dell'agente principale.
5. **Revisione proporzionata.** I controlli deterministici girano sempre. La revisione di un modello distinto avviene solo sui lotti che aggiungono fatti al canone. Questa decisione supera «Revisione indipendente sempre» dell'indice.
6. **Migrazione dopo l'aggiornamento.** Le campagne esistenti passano al nuovo formato con una migrazione post-update, reversibile con git e riprendibile.

## Proposta di architettura

### 1. Ruoli e modelli

- **Autore.** L'agente principale, con il modello di alto livello, parla con il master e scrive mondo, schede e scene nella conversazione principale. Non esiste più un sub-agent che esegue il processo al suo posto.
- **Esecutori economici.** Ricevono dall'autore un ordine preciso e delimitato: espandere un abbozzo in una scheda completa a partire da un pacchetto di contesto, estrarre i fatti da un documento, giudicare un link ambiguo. Lavorano in parallelo su file diversi.
- **Revisore.** Un sub-agent distinto, lanciato una volta per lotto, giudica solo ciò che uno script non può giudicare: contraddizioni di senso e segreti finiti nel testo pubblico.
- **Scelta automatica.** Quando delegare e a quale modello lo decide il framework in base alla dimensione del lavoro. Il master non vede né sceglie nulla.

### 2. Il motore

Un solo programma a riga di comando sostituisce il cablaggio di scrittura, il linker come skill, il piano geografico e i controlli sparsi. L'autore lo chiama con una chiamata per operazione.

- `context`: dato ciò che si sta per scrivere (soggetti, luogo, sessione), restituisce un pacchetto di contesto compatto: il seme del mondo, i soggetti vicini nel grafo, la cronologia pertinente, i fili aperti.
- `commit`: prende un lotto di bozze e, in un'unica transazione, valida formato e schema dell'adattatore, controlla il grafo, risolve i link, aggiorna gli indici e salva la versione. Se qualcosa non va, non scrive nulla e restituisce gli errori in JSON.
- `check`: gli stessi controlli, senza scrivere.
- `query`: domande strutturate sul mondo (chi sta dove, chi è legato a chi, che cosa è successo prima di una data).

Gli errori meccanici (campo mancante, tabella malformata, link rotto) tornano all'autore dal motore, prima di ogni revisione. Il revisore non controlla il formato.

### 3. Il mondo come grafo

Il Markdown resta l'unica fonte di verità. I metadati in testa a ogni documento dichiarano i dati che gli script devono poter usare:

- il tipo del soggetto (luogo, personaggio, creatura, oggetto, fazione, evento);
- le relazioni con altri soggetti, con un tipo (appartenenza, parentela, alleanza, rivalità, dipendenza);
- il luogo e, per gli eventi, la data o la posizione nella cronologia;
- lo stato (per esempio vivo o morto, attivo o distrutto).

Dai documenti si deriva un indice con soggetti, relazioni, cronologia e fatti. È un derivato: si rigenera e non si modifica a mano. Su questo indice il motore controlla, senza alcun modello, i riferimenti a soggetti inesistenti, le date impossibili, un soggetto morto che agisce dopo la morte, un personaggio in due luoghi nello stesso momento.

I modelli di scheda si arricchiscono: motivazioni, legami, segreti e agganci di trama per i personaggi; abitanti, punti d'interesse e agganci per i luoghi. Si aggiungono i tipi fazione ed evento storico.

### 4. Il seme del mondo

Un documento sempre presente nel contesto dell'autore: genere, temi, conflitti centrali, fazioni, culture, convenzioni dei nomi, livello di potere, cose da evitare. Nasce dall'intervista iniziale, che chiede queste cose in poche domande, e il master lo può correggere in qualunque momento parlando. Sostituisce la frase unica di descrizione in `campaign.yaml`.

### 5. Generazione a passate e abbozzi

1. **Scaletta.** Dal seme l'autore produce una scaletta di abbozzi: una riga per soggetto, con le relazioni già dichiarate. Regioni, luoghi, fazioni, figure chiave, eventi della storia.
2. **Espansione.** Gli abbozzi che servono subito diventano schede complete, in parallelo, ciascuna con il proprio pacchetto di contesto.
3. **Coerenza.** Un `commit` unico per il lotto: controlli del grafo, poi la revisione di un modello.

Un abbozzo è un documento valido del canone. Resta tale finché non serve: quando il master lo nomina o una sessione lo usa, viene espanso. Così il mondo iniziale è ampio ma poco costoso, e il dettaglio arriva dove si gioca.

Lo stesso percorso serve le richieste singole: «crea un oste burbero al Vecchio Mulino» è un lotto di un documento.

### 6. Provenienza al posto del divieto

Ogni contenuto porta la sua provenienza: detto dal master, giocato al tavolo, generato dal framework. La regola è una sola: ciò che il master ha detto o che è stato giocato non si sovrascrive e non si contraddice; ciò che è generato si può rigenerare o cambiare liberamente, e il master viene avvisato in una frase di che cosa è nuovo.

Questa regola sostituirebbe il blocco della fantasia per default, i valori `IMAGINATION` e `PROPOSE` e la domanda a quattro risposte. Restano fermi: la cronaca della serata riporta solo ciò che il master racconta, e la trascrizione del materiale importato è fedele alla fonte.

### 7. Adattatori generativi

Oltre allo schema delle schede, un adattatore dichiara ciò che serve per costruire contenuti giocabili: il budget di una creatura per livello di sfida, le difficoltà per fascia, le fasce di prezzo, le ricompense. Il motore valida ogni scheda generata contro queste tabelle. Una descrizione vaga («un capo bandito tosto per un gruppo di terzo livello») diventa una scheda completa e verificata.

Senza adattatore, le difficoltà e i valori restano in parole, come oggi.

### 8. Processi

I processi diventano intenti riconosciuti dall'autore, descritti da skill brevi (obiettivo, vincoli, contratto di formato) e non da procedure passo per passo:

- costruire o ampliare il mondo;
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
| Lo spostamento geografico dei file a ogni scrittura | L'estrazione dei fatti dell'audit, che alimenta l'indice |
| Le skill procedurali di centinaia di righe | Il caricamento dell'adattatore, le campagne di prova |

### 10. Migrazione

Una migrazione post-update porta le campagne esistenti al nuovo formato: aggiunge ai documenti i metadati di tipo e provenienza (tutto il contenuto esistente è «detto dal master»), ricava le relazioni che si possono leggere con certezza e lascia in sospeso le altre, costruisce l'indice. Non riscrive la prosa. È reversibile con git e si può riprendere dopo un'interruzione.

### 11. Misura

- **Tempo come criterio.** Ogni caso di prova ha un tempo massimo e un numero massimo di chiamate; superarli è un fallimento. Obiettivi iniziali, da verificare: una scheda sotto il minuto, una sessione in due o tre minuti, un mondo iniziale di una trentina di soggetti in cinque-dieci minuti.
- **Casi di generazione.** Da un seme con vincoli seminati, il mondo generato deve rispettarli: si verifica sul grafo, senza leggere la chiave.
- **Qualità.** Una griglia per il contenuto creativo (specifico, giocabile, coerente con il seme), giudicata da un modello distinto.

## Decisioni dell'indice toccate

| Decisione dell'indice | Effetto |
|---|---|
| Revisione indipendente sempre | Superata dalla decisione 5 |
| Più agenti, con ruoli distinti (esecuzione a modelli economici) | Modificata dalla decisione 4: la scrittura creativa è dell'agente principale |
| Skill robuste (istruzioni che funzionano anche con Codex) | Modificata dalla decisione 4: Codex esce dal percorso creativo |
| Fantasia del modello, bloccata per default | Da confermare: la proposta 6 la sostituisce |
| L'intervista iniziale crea solo i file core | Da confermare: le proposte 4 e 5 generano un mondo iniziale |
| Organizzazione geografica | Da confermare: la proposta 2 la riduce a vista derivata |
| Trascrizioni locali del feedback | Da confermare: fuori dal percorso normale, attive solo in sviluppo |
| Sessioni gestite dal framework | L'obiettivo resta; il meccanismo di argomenti e handoff va riprogettato |

## Documenti da riscrivere

Principi, Architettura, Orchestrazione degli agenti, Processi di core, Skill di libreria, Formato dei contenuti, Sistemi di gioco e stili, Configurazione, Robustezza e test, Gestione delle sessioni. Fino alla riscrittura restano come descrizione del framework attuale.

## Piano di lavoro

1. **Formato e indice.** Metadati di tipo, relazioni, cronologia e provenienza; indice derivato; controlli del grafo.
2. **Motore.** `context`, `commit`, `check`, `query`, con i loro test.
3. **Seme e generazione.** Intervista, seme del mondo, scaletta, espansione in lotto, revisione di coerenza.
4. **Adattatore generativo.** Tabelle di costruzione e validazione per D&D 2024.
5. **Processi.** Sessione, dopo la sessione con le conseguenze, domande, import.
6. **Migrazione** delle campagne esistenti.
7. **Testbench.** Tempi massimi, casi di generazione, griglia di qualità.

## Questioni aperte

- **Fantasia.** L'autore conferma che il default diventa «inventa e dichiara», con la regola di provenienza della proposta 6?
- **Grana della provenienza.** Per documento, per sezione o per singolo fatto? Per documento è semplice ma grossolano: una scheda generata in cui il master corregge una frase diventa mista.
- **Scaletta.** Il master la conferma prima dell'espansione, oppure il framework genera tutto e il master corregge dopo? La decisione 3 spinge verso la seconda.
- **Dimensione del mondo iniziale.** Quanti soggetti genera l'intervista, e chi lo decide.
- **Dati delle regole.** Le tabelle di costruzione stanno nell'adattatore (va verificata la licenza dei testi del gioco) oppure il modello usa la propria conoscenza, validata dallo schema?
- **Organizzazione geografica.** Resta la posizione canonica dei file o diventa una vista derivata?
- **Sessioni lunghe.** Che cosa sostituisce argomenti e handoff: il pacchetto di contesto del motore basta a riprendere il lavoro?
- **Soglie di delega.** Da quale dimensione del lotto conviene delegare l'espansione ai modelli economici.
- **Codex.** Con Codex ridotto ad adattatore di immagini, il plugin per Codex resta?
