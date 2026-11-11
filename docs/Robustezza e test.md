# Robustezza e test

**Stato:** Bozza di progetto. Riscritto dopo la [Riprogettazione](Riprogettazione.md) (2026-11-11).
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

Questo documento raccoglie i problemi di affidabilità dichiarati dall’autore nelle skill di collegamento e di audit, i modi di fallimento che si possono ipotizzare per questo tipo di lavoro, e il metodo per misurarli in modo ripetibile. I modi di fallimento sono ipotesi generali: nessuno è stato riprodotto in modo controllato. Le proposte si basano sul principio che la parte meccanica sia uno script e la parte di giudizio sia dell’agente.

Dopo la [Riprogettazione](Riprogettazione.md) il collegamento e i controlli non sono più skill con un cablaggio proprio: i controlli meccanici stanno nel motore (`check` e `commit`), il giudizio sta nell’autore, negli esecutori economici o nel revisore di lotto. I casi di prova misurano queste parti e il framework nel suo insieme.

## Scopo

Una skill è affidabile quando lo stesso lavoro produce lo stesso esito indipendentemente da quale modello lo esegue e da quante volte viene eseguito. Nelle prime versioni delle skill questo non avviene. Il framework deve poter dire, per ogni parte del lavoro, quanto spesso sbaglia e in quale modo, e deve poter dimostrare che una modifica alle istruzioni migliora davvero.

## Problemi dichiarati dall’autore

- **La skill dei collegamenti collega alcune menzioni ma non tutte.** L’istruzione di collegare «ogni menzione» era nelle istruzioni della skill, ma non era verificata da nulla.
- **L’audit di continuità non segnala quasi mai nulla, eppure gli errori capitano.** Nella proposta precedente l’audit era eseguito prima di ogni modifica. Dal 2026-11-10 la revisione della bozza passava al revisore indipendente; dal 2026-11-11 (Riprogettazione, decisione 5) la revisione avviene solo sui lotti che aggiungono fatti al canone. L’audit resta una funzione esplicita, su richiesta, e non è più nel percorso di scrittura.
- **Gli esecutori economici hanno bisogno di istruzioni più esplicite di quelle che scrive l’autore.** Osservazione dell’autore sui modelli: le istruzioni devono funzionare anche per i modelli minori. Codex non è più un agente del framework (Riprogettazione, decisione 11); la regola resta per gli esecutori economici.

## Modi di fallimento noti

Le voci seguenti derivano dalla lettura delle istruzioni di collegamento e di audit. Ciascuna descrive un modo generico in cui questo tipo di lavoro può fallire, e la contromisura che il framework adotta. Il livello di confidenza indica quanto l’ipotesi sia sostenuta dai file, non quanto sia dimostrata.

| ID | Modo di fallimento | Come si presenta | Contromisura del framework | Confidenza |
|---|---|---|---|---|
| F1 | Il collegamento perde candidati | Un passaggio deterministico che enumerava i candidati scompare in una modifica, e le istruzioni che lo richiamavano non vengono aggiornate. Il controllo ricade sulla sola lettura del modello. | L’enumerazione delle occorrenze è affidata a uno script deterministico (vedi [Indice dei soggetti](#indice-dei-soggetti)). Dalla Riprogettazione sta nel motore. La rimozione di uno script è una modifica del framework che passa dai test di regressione. | Media (la perdita del passaggio è verificabile; l’effetto sulla qualità è ipotesi) |
| F2 | Riferimenti a strumenti inesistenti | Una skill cita uno strumento, un grafo o un comando che non esiste più. L’agente tenta di usarlo, oppure salta il passo senza dirlo. | Un controllo verifica che ogni strumento, script o comando citato nelle istruzioni esista nel pacchetto, e fallisce altrimenti. | Alta (il riferimento si verifica con una ricerca); media (l’effetto dipende dal modello) |
| F3 | Nessun inventario dei soggetti | Il passo che chiede di «costruire una mappa di nomi» non ha un elenco prodotto da uno script, con alias e forme ortografiche. Trovare ogni menzione richiede di ricordare decine di occorrenze in documenti lunghi, e le occorrenze ripetute nelle pagine lunghe sono le prime a sfuggire. | Un indice dei soggetti derivato dagli `aliases` delle schede, con le forme da cercare. | Media |
| F4 | Eccezioni non definite con precisione | Le esclusioni (titoli, corsivi narrativi, blocchi di codice, commenti) sono elencate a parole. Tabelle, diagrammi e le etichette dei nodi non sono citati, e il modello deve riconoscere a occhio la sintassi di ogni eccezione. Un diagramma è una zona grigia che può essere trattata in modi diversi a ogni esecuzione. | Eccezioni sintattiche documentate e applicate dallo script, con stati espliciti (vedi [Scansione e stati delle occorrenze](#scansione-e-stati-delle-occorrenze)). Ogni tipo di blocco ha un caso di prova. | Media |
| F5 | Esiti che escludono il link | Il percorso di minor resistenza è omettere: la maggior parte degli esiti impedisce di applicare il link, e il revisore dei link, che opera in sola lettura, tendeva a non approvare ciò che non poteva verificare fino in fondo. Le istruzioni chiedevano inoltre di collegare solo «corrispondenze sostanziali» e di non collegare «parole generiche», criteri che lasciano spazio all’omissione. Il revisore dei link è stato eliminato (Riprogettazione, sezione 9): il rischio passa al giudizio sulle ambiguità. | Il motore restituisce le ambiguità (`ambiguousMentions`) e le omissioni con il motivo; la copertura è una metrica misurata (vedi [Metriche](#metriche)), che rende visibile il costo di omettere. | Media |
| F6 | Audit che non trova nulla | L’audit chiede di leggere tutti i file, che in un archivio grande sono molti. Le istruzioni sono prevalentemente negative. Un agente che legge una frazione dei file e ha istruzioni negative tende al silenzio, e il silenzio non è distinguibile da un controllo completo, perché l’audit non produce un registro di copertura. | Un registro di copertura generato da script. Una dichiarazione di «nessun problema» senza registro è invalida. | Alta per la copertura non verificabile; media per l’effetto negativo |
| F7 | Confronto in prosa | L’audit confronta fatti in forma narrativa. Una contraddizione fra due frasi distanti non viene estratta né confrontata in modo sistematico. | Estrazione dei fatti in forma strutturata e confronto meccanico (vedi [Audit con fatti strutturati](#audit-con-fatti-strutturati)). | Media |
| F8 | Ambito dell’audit non definito | Nella proposta precedente l’audit pre-modifica aveva un ambito soggetto a sottocopertura o sovraccarico. Il passaggio automatico è stato rimosso dal cablaggio di scrittura; il revisore del lotto confronta la bozza con il canone e con il seme solo quando il lotto aggiunge fatti, e l’audit autonomo, su richiesta, può essere completo. | Dichiarare i documenti forniti al revisore del lotto e mantenere il registro di copertura negli audit autonomi. | Media |
| F9 | Istruzioni condizionali in prosa | Formule come «se disponibile», «quando possibile», «altrimenti uno strumento consentito» vengono risolte saltando il ramo più costoso. Il file di metadati di un agente contiene solo la policy di invocazione, senza istruzioni operative. | Regole di scrittura con default esplicito e comando esatto per ogni agente (vedi [Istruzioni per gli esecutori economici](#istruzioni-per-gli-esecutori-economici)). | Media |
| F10 | Revisione non verificabile | Il revisore riceve proposte, estratti e percorsi, ma non un formato di evidenza fisso, e il suo esito è una valutazione libera. Due revisioni della stessa proposta possono dare esiti diversi senza che nulla lo riveli. | Un formato di evidenza fisso per ogni voce, con localizzatore obbligatorio, validato dallo script. | Media |

### Misurare prima di fissare soglie

Un conteggio grezzo delle occorrenze di un soggetto, per sottostringa e senza confini di parola, include titoli, diagrammi, blocchi di codice e le esclusioni dichiarate. È quindi un limite superiore del numero di menzioni non collegate, non il numero di errori: un nome che compare cento volte in una cartella di sessioni può avere molte occorrenze dentro titoli o blocchi di codice.

Un conteggio come questo non misura la qualità dei collegamenti. Serve come base per la metrica di copertura, cioè il numero di menzioni eleggibili collegate correttamente, con la stessa definizione di eleggibile applicata a tutti i run.

Ogni run di prova copia soltanto la cartella `campaign/` nell’ambiente dell’agente; la chiave resta fuori dalla copia. Il rapporto misura il tasso di successo per modello e hash delle istruzioni e include soltanto run realmente eseguiti.

## Principio: deterministico per il meccanico, agente per il giudizio

Proposta: ogni parte del lavoro di controllo si divide in tre strati.

```text
1. Script deterministico   trova, conta, confronta, verifica (sempre uguale a ogni run)
2. Agente                  decide solo i casi che lo script ha marcato come ambigui
3. Revisore                secondo giudizio su ciò che l’agente propone, con formato di evidenza fisso
```

Lo script produce un rapporto completo; l’agente riceve l’elenco ridotto ai casi da decidere; il revisore riceve le evidenze in forma strutturata. Ogni strato lascia un file, così la sua uscita si può confrontare con quella di un altro modello.

Ciò che deve essere deterministico: l’individuazione delle menzioni, l’applicazione delle eccezioni sintattiche, la verifica che un link risolva, il confronto dei valori, il conteggio dei file letti. Ciò che resta all’agente: decidere se una somiglianza è un’identità, se due prove sono davvero in conflitto, se un’ipotesi del brainstorming diventa un fatto.

## Indice dei soggetti

**Implementato in 0.30.0 in parte:** `commit` ricostruisce `.campaign/cache/subjects.json` e `.campaign/cache/world.json` (grafo del mondo, vedi [Riprogettazione](Riprogettazione.md), sezione 3). Sono derivati: si ricostruiscono dai file e si possono cancellare. Non si scrivono a mano.

Proposta (forma e stati delle forme): uno script genera l’indice dei soggetti a partire dagli `aliases` delle schede. Ogni forma nasce da un alias o dal titolo di una scheda. Con questo indice la scansione non cerca più i nomi a memoria: li trova tutti.

### Forma dell’indice

Esempio fittizio, con la campagna d’esempio «Le maree di Calvane». È la struttura generata, con chiavi in inglese. Gli stati delle forme e le relazioni `figure-through` sono Proposta, non ancora implementate:

```json
{
  "subjects": [
    {
      "id": "porto-di-selce",
      "type": "location",
      "sheet": "Mondo/Costa di Calvane/Porto di Selce/Porto di Selce.md",
      "forms": [
        { "text": "Porto di Selce", "status": "fact" },
        { "text": "Selce", "status": "hypothesis" }
      ],
      "anchors": ["Storia"],
      "do_not_link_as": []
    },
    {
      "id": "ilde-varno",
      "type": "character",
      "sheet": "Personaggi/…",
      "forms": [
        { "text": "Ilde Varno", "status": "fact" }
      ],
      "relations": [
        { "type": "figure-through", "to": "consiglio-del-faro", "status": "fact" }
      ]
    }
  ]
}
```

Due distinzioni sono essenziali:

- **Alias e figura tramite non sono la stessa cosa.** Un alias dichiara che due forme indicano lo stesso soggetto. Una figura tramite dichiara che un soggetto agisce attraverso un altro senza esserlo. In una campagna può capitare che una divinità pregata sia il volto di un’altra entità, o che un personaggio parli a nome di un’istituzione senza esserne l’istituzione. L’indice deve poter registrare la relazione senza fonderla in un’identità, perché il collegamento non deve mai collegare due soggetti come se fossero uno.
- **Lo stato di ogni forma è dichiarato.** Una forma `hypothesis` può generare una menzione da segnalare al revisore, non un link automatico. Una forma `fact` può essere collegata senza domande. Lo stato proviene dal master o dalla scheda, mai dall’agente.

### Generazione e validazione

- Lo script legge il titolo della scheda, i suoi `aliases` e i titoli `##` (le ancore). Non inventa forme: ogni forma nasce da un titolo o da un alias della scheda.
- Un’omonimia (due soggetti con la stessa forma) è un errore di indice, non una scelta silenziosa: lo script la elenca, e il master o l’agente la risolvono con `do_not_link_as` o con una forma più precisa.
- Le forme sono confrontate in modo normalizzato: maiuscole, accenti, tipo di apostrofo (’ o ') e trattini. È la stessa regola che l’enciclopedia pubblica usa per i titoli, perché le tastiere scrivono i caratteri in modo diverso.

### Scansione e stati delle occorrenze

Lo script percorre ogni Markdown e assegna a ogni occorrenza di una forma uno stato. Le regole di eccezione sono sintattiche e documentate, non lasciate al modello.

| Stato | Quando | Azione |
|---|---|---|
| `linked` | già dentro un link verso la scheda del soggetto | nessuna |
| `linked-elsewhere` | dentro un link verso un’altra destinazione | l’agente verifica se è un errore |
| `bare` | menzione eleggibile senza link | proposta di link |
| `ambiguous` | la forma corrisponde a più soggetti, o è una parola comune | decisione dell’agente, con il revisore |
| `excluded-title` | nel testo di un titolo | nessuna |
| `excluded-italic` | in narrazione `_testo_` letta ai giocatori (convenzione di formattazione) | nessuna |
| `excluded-code` | in un blocco con tre backtick o in codice inline | nessuna |
| `excluded-comment` | in un commento HTML | nessuna |
| `excluded-diagram` | in un diagramma Mermaid | nessuna: un link Markdown dentro un’etichetta rompe il diagramma (**Deciso**, 2026-11-07) |

La convenzione del corsivo narrativo è una regola della campagna, non del framework: va dichiarata nella configurazione (vedi [Configurazione](Configurazione.md)), e lo script la legge da lì.

### Esempio di rapporto

Il rapporto è un file generato, non un documento della campagna. Esempio fittizio della forma che lo script dovrebbe produrre:

```text
soggetto: porto-di-selce   scheda: Mondo/Costa di Calvane/Porto di Selce/Porto di Selce.md
  Trama/Sessione 1.md:209          bare         «...l’officina di canoe abbandonata a Porto di Selce (Sessione 2)...»
  Uscite/Mappa della trama.md:16    to-decide    «subgraph PORTO["Porto di Selce"]» (diagramma)
  Uscite/Mappa della trama.md:27    to-decide    «S2 --> VIA["Viaggio fino al faro"]» (diagramma)
soggetto: ilde-varno   ambiguous con: ilde-sarto
  Trama/Il faro di notte.md        ambiguous  «...» (riga da calcolare dallo script; somiglianza, nessuna identità dichiarata)
```

Il rapporto non dice quale link applicare. Dice quali occorrenze esistono, in quale stato, e quali decisioni servono. Il caso di Ilde Varno e di Ilde Sarto mostra la distinzione: la somiglianza del nome non è un’identità, e il rapporto la marca come ambigua invece di collegarla.

### Metrica che ne deriva

La copertura dei collegamenti è misurabile: menzioni eleggibili collegate correttamente divise per menzioni eleggibili (le `bare`, le `linked` e le `ambiguous` risolte). Il rapporto può essere confrontato fra un run e l’altro, e fra versioni delle istruzioni.

## Collegamenti con indice

> **Superata in parte dalla Riprogettazione (2026-11-11).** Il revisore dei link su ogni proposta è stato eliminato (sezione 9). I link si applicano con `commit` del motore, che collega solo le menzioni esplicite con forma `fact` e restituisce le ambiguità (`ambiguousMentions`) perché l’autore le decida. La skill dei collegamenti come tale non esiste più. I passi 1, 2, 5 e 6 corrispondono alle funzioni del motore (`check` e `commit`); i passi 3 e 4 sono eliminati.

Sequenza proposta (storica):

1. Lo script di indice e scansione genera il rapporto per l’insieme di file richiesto.
2. Lo script raggruppa le proposte in tre elenchi: link da applicare (`bare` con soggetto `fact`), link da revisionare (`ambiguous`, `linked-elsewhere`), decisioni (`to-decide`).
3. L’agente prepara per ogni voce un testo prima e dopo, la destinazione relativa, e il motivo in una frase.
4. Il revisore, con formato di evidenza fisso (vedi sotto), approva, corregge, omette o chiede conferma.
5. Uno script applica i link approvati, rispettando le eccezioni, e rigenera il rapporto: le menzioni `bare` residue devono essere zero oppure elencate con il motivo.
6. Una sola verifica completa dell’intero ambito interessato controlla che i percorsi risolvano, che i frammenti `#ancora` corrispondano a titoli esistenti e che il numero di blocchi di codice non sia cambiato. Il rapporto e il risultato dettagliato in `.campaign/state/linker/check.json` registrano i file controllati e gli errori; il cablaggio di scrittura li consuma senza ripetere i controlli dei link.

Il formato di evidenza del revisore è una riga per voce, con campi fissi: `id`, `file`, `occurrence`, `target`, `evidence` (localizzatore della scheda o della fonte), `outcome` (uno degli esiti della scala definita in [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md)) e `reason` (una frase). Un esito senza localizzatore non è valido, e lo script lo rifiuta. Per i link il formato è superato; resta come proposta per ogni revisione di un elenco di voci.

### Regole per le identità

- Un link a una scheda è sempre consentito quando la menzione è esplicita e la forma è `fact`.
- Una somiglianza, un omonimo o una figura tramite non producono mai un link automatico. Producono una decisione.
- Un’identità nuova non è mai scritta dalla scansione dei link: se la campagna la stabilisce, va registrata nella scheda o nell’indice dal master.

## Audit con fatti strutturati

Il modo di fallimento F6 nasce dal chiedere all’agente di leggere tutto e di segnalare ciò che non torna. Proposta: estrarre prima i fatti in forma strutturata, confrontarli con uno script, e lasciare all’agente la classificazione.

### Ambito

**Proposta precedente (2026-11-08, superata).** L’ambito pre-modifica doveva essere largo: i soggetti toccati comprendevano quelli menzionati nei documenti coinvolti e i documenti che li citavano; fatti estratti e copertura erano memorizzati in cache. Dal 2026-11-10 la revisione della bozza era affidata al revisore con i documenti di contesto in sola lettura. Dalla [Riprogettazione](Riprogettazione.md) (2026-11-11, decisione 5) il passaggio automatico non esiste più: il revisore del lotto si lancia solo sui lotti che aggiungono fatti al canone. Questo disegno resta una proposta storica.

**Audit autonomo.** La skill `continuity-audit` resta disponibile per un audit completo su richiesta. Non è più richiamata dal percorso di scrittura. Le regole di estrazione, confronto e copertura qui sotto descrivono quella skill.

Il riesame della copertura può riutilizzare un esito positivo soltanto quando coincidono gli hash di tutte le dipendenze della revisione, inclusi fatti validati, vocabolario, documenti inclusi e istruzioni del revisore. Si conserva solo un esito `CONFIRMED` valido con `missed=[]`, dopo che l’estrazione è completa, non restano file da leggere e non ci sono fatti scartati; esiti mancati, incompleti o non validi non si riusano. Quando un lotto aggiunge fatti, la revisione del lotto resta obbligatoria anche se si riusa il riesame della copertura. La cache derivata sta in `.campaign/cache/audit-coverage/`.

Il registro di copertura è generato dallo script: elenca ogni file incluso, il numero di fatti estratti e lo stato (`to-read`, `read`, `extracted`, `not-relevant`). Un audit senza registro non è dichiarato completo.

### Estrazione dei fatti

Ogni documento è trasformato in un elenco di fatti. Lo schema è fisso. Esempio fittizio:

```json
{"id":"F-000123",
 "document":"Mondo/Costa di Calvane/Porto di Selce/Porto di Selce.md",
 "section":"Storia",
 "locator":"riga 42",
 "subject":"porto-di-selce",
 "attribute":"data_fondazione",
 "value":"anno 1845",
 "source_type":"editorial-summary",
 "quote":"testo esatto del passo"}
```

I tipi di fonte rispecchiano la classificazione prevista dall’audit: chiarimento dell’autore (`author-clarification`), affermazione di una fonte con la sua prospettiva (`source-claim`), sintesi editoriale (`editorial-summary`), ipotesi (`hypothesis`), silenzio documentale (`documentary-silence`). Il tipo è assegnato dall’agente di estrazione, ma verificato dallo script quando la fonte è `hypothesis` o una voce di brainstorming.

Controlli deterministici sull’estrazione:

- la `quote` deve comparire nel documento, dopo normalizzazione di spazi e apostrofi;
- il `document` deve esistere, e la `section` deve corrispondere a un titolo;
- ogni fatto con `value` numerico o data deve avere un `attribute` dichiarato nello schema;
- un fatto senza citazione verificabile è scartato e conteggiato.

Lo schema può essere affidato a più agenti in parallelo (per esempio uno per documento o per cartella), perché l’estrazione è lettura e produce file. Ciò rende l’audit più ampio di quanto un singolo contesto possa contenere.

### Confronto meccanico

Lo script raggruppa i fatti per soggetto e attributo e segnala:

- stesso soggetto e attributo con valori diversi (data, numero, luogo, relazione);
- stessa relazione dichiarata in direzioni opposte;
- valori che compaiono solo in una delle fonti di una coppia dichiarata come corrispondente.

Il confronto produce candidati, non verdetti. Un valore diverso può essere un cambiamento nel tempo, una prospettiva, una rivelazione successiva. È il giudizio a decidere.

### Giudizio e classificazione

L’agente riceve solo i candidati, insieme ai fatti che li generano e alle esclusioni applicabili. Classifica ciascuno in una delle categorie previste dall’audit: contraddizione diretta, discrepanza possibile, dettaglio non spiegato, differenza di prospettiva, conflitto fra attestazioni. Per ogni classificazione indica il localizzatore dei fatti coinvolti.

Il registro delle esclusioni è letto dallo script prima del giudizio: un candidato coperto da un’esclusione non arriva all’agente. Questo evita che la stessa voce sia riproposta a ogni audit, e rende verificabile che l’esclusione è stata applicata.

### Checklist mirate

Accanto al confronto generale, alcune verifiche sono regole meccaniche e vanno fatte come checklist con esito binario. Esempi di controlli meccanici:

- ogni scheda con un blocco riservato al master ha il blocco chiuso e unico (controllo del validatore del blocco riservato);
- il testo di un blocco riservato non compare nell’output pubblico (controllo di fuga);
- ogni personaggio citato in una sessione ha una scheda o è marcato come comparsa;
- i campi `depends_on` puntano a sessioni esistenti;
- nessun documento del framework nomina il mondo o il sistema di gioco, salvo i moduli che li dichiarano.

Le checklist non sostituiscono il giudizio: lo rendono più difficile da saltare, perché ogni voce ha un esito scritto.

### Istruzioni per evitare il silenzio

Un audit che termina con «nessun problema» deve allegare il registro di copertura e l’elenco dei candidati scartati con il motivo. Una dichiarazione di nessun problema senza registro è invalida.

## Istruzioni per gli esecutori economici

Le istruzioni che l’autore scrive per gli esecutori economici (per esempio Haiku) devono funzionare anche con un modello minore. Regole di scrittura proposte, in base ai modi di fallimento F9 e F6:

1. **Passi numerati, ciascuno con un file di uscita nominato.** Il passo successivo legge quel file, non la memoria del passo precedente.
2. **Nessuna condizione senza default.** Non «se disponibile, usa X». Scrivere «usa X; se il comando fallisce, scrivi il motivo in `outcomes.md` e ferma il passo».
3. **Strumenti nominati.** Il comando esatto (per esempio il percorso dello script e gli argomenti) è scritto nelle istruzioni, non descritto.
4. **Criterio di fine verificabile.** «Termina quando il registro di copertura elenca tutti i file con stato diverso da `to-read`» è verificabile; «leggi tutto» no.
5. **Formato di output fisso,** con un esempio corretto e uno sbagliato.
6. **Affermazioni positive.** Limitare i divieti a quelli che servono davvero, e ogni divieto accompagnato dalla cosa da fare al suo posto.
7. **Istruzioni brevi per ciascun modello.** Le istruzioni più lunghe vanno divise in file richiamati dai passi, così che un modello non debba trattenere l’intero documento.

Codex non è un esecutore del framework (Riprogettazione, decisione 11): le regole restano valide per gli esecutori economici di Claude.

## Casi di prova

Proposta: i casi di prova stanno nella cartella `testbench/`, uno per cartella, raggruppati per area (collegamenti, audit, generazione). Ogni caso ha una campagna d’esempio sintetica, una richiesta e un esito atteso. La chiave sta fuori dalla cartella che l’agente può leggere: a ogni run si copia soltanto `campaign/`.

```text
testbench/
  links/
    multiple-mentions/
      campaign/        copia della fixture, che il caso può modificare
      request.md       ciò che l’autore chiede, in linguaggio naturale
      expected.yaml    esito atteso, verificabile
  audit/
    distant-contradiction/
      campaign/
      request.md
      expected.yaml
  ...
```

Esempio di esito atteso, fittizio:

```yaml
# testbench/links/multiple-mentions/expected.yaml  (esempio)
case: links-multiple-mentions
must_link:
  - file: "Trama/sessione-03.md"
    occurrences: 3                 # tutte le occorrenze, non solo la prima
    target: "Mondo/Costa di Calvane/Porto di Selce/Porto di Selce.md"
must_not_link:
  - file: "Trama/sessione-03.md"
    context: title
  - file: "Trama/sessione-03.md"
    context: italic-narration
  - file: "Trama/sessione-03.md"
    context: code-block
expected_decisions:
  - subject: "ilde-sarto"
    form: "Ilde"
    outcome: ASK                   # somiglianza, nessuna identità dichiarata
```

Tipi di caso proposti.

- **Collegamenti:** menzione singola; menzioni multiple; titolo non collegato; corsivo narrativo non collegato; blocco di codice e commento intatti; omonimo ambiguo, con decisione attesa; figura tramite non trattata come alias; link errato da correggere; nessuna proposta quando non c’è nulla da collegare.
- **Audit:** contraddizione diretta fra due schede a distanza; discrepanza di prospettiva non classificata come errore; esclusione registrata non riproposta; fonte storica superata dal canone attuale non segnalata come problema; ipotesi del brainstorming non presentata come contraddizione; revisione del lotto che aggiunge fatti contro il canone e il seme.
- **Generazione:** da un seme con vincoli seminati, il mondo generato rispetta i vincoli (vedi [Misura](#misura)).
- **Generale:** l’agente non modifica file in modalità sola analisi; l’agente non prende decisioni che il rapporto dichiara da chiedere; ogni strumento citato nelle istruzioni esiste (vedi la tabella dei modi di fallimento, F2).

### Esecuzione con Claude

Lo stesso caso viene eseguito con le stesse istruzioni e la stessa campagna copiata. Uno script avvia l’esecuzione e raccoglie l’uscita. Il confronto è fatto sull’esito dello script di verifica e sull’atteso, non sul giudizio di chi ha eseguito il caso. Il testbench misura solo Claude (Riprogettazione, decisione 11).

- Ogni caso si esegue più volte (proposta: tre), perché i modelli non sono deterministici. Il risultato è la percentuale di esecuzioni in cui il caso passa, non un singolo passaggio.
- Il risultato è registrato con modello, versione, data e impronta delle istruzioni. Quando cambiano le istruzioni, il risultato precedente non vale più.
- Un caso che supera il tempo massimo o il numero massimo di chiamate di strumento fallisce (vedi [Misura](#misura)).

Da verificare: se `claude plugin eval` e `/skill-doctor`, citati nella descrizione dello strumento di guida per Claude Code, possono coprire parte di questa proposta. Non è verificato.

### Scoring

- Il più possibile deterministico: lo script di verifica controlla link, eccezioni rispettate, file modificati, file non toccati.
- Per gli esiti in linguaggio naturale (classificazioni dell’audit), una rubrica con voci binarie: il localizzatore è presente, la categoria è quella attesa, l’esclusione non è riproposta.
- Il giudice non è l’agente che ha prodotto l’esito. Per la griglia di qualità il giudice è un modello distinto (vedi [Misura](#misura)); per le rubriche binarie, proposta: un secondo run, con un modello diverso, sulla sola rubrica.

## Misura

Regole di misura della [Riprogettazione](Riprogettazione.md), sezione 11 (**Deciso**, 2026-11-11). Valgono per ogni caso di prova.

- **Tempo e chiamate come criteri di fallimento.** Ogni caso dichiara un tempo massimo e un numero massimo di chiamate di strumento. Superare uno dei due limiti è un fallimento, anche se l’esito è corretto. I valori dei limiti per caso sono Proposta.
- **Obiettivi iniziali, da verificare.** Una scheda sotto il minuto; una sessione in due o tre minuti; una regione di una trentina di soggetti in cinque-dieci minuti. Sono obiettivi da verificare con la prima misura, non soglie.
- **Casi di generazione.** Da un seme con vincoli seminati (vedi [Fixture](#fixture-di-campagna-desempio)), il mondo generato deve rispettarli. La verifica avviene sul grafo, con le interrogazioni del motore, senza che la chiave venga letta da chi esegue il caso.
- **Qualità.** Una griglia per il contenuto creativo: specifico, giocabile, coerente con il seme. La giudica un modello distinto da quello che ha scritto il contenuto. I criteri e le soglie della griglia sono Proposta.
- **Delega.** Il testbench misura tempi e costi con e senza esecutori economici, per tarare quando il framework delega (decisione 16). La soglia di delega non sta nella specifica.
- **Solo Claude.** Il testbench misura solo Claude, perché il plugin per Codex è rimosso (decisione 11).

## Fixture di campagna d’esempio

Proposta: una campagna d’esempio sintetica, costruita apposta per il test, senza elementi di una campagna reale né di un sistema di gioco specifico. Serve perché i casi di prova non si eseguano sulla campagna reale, che cambia e non ha una risposta nota.

Caratteristiche minime:

- circa trenta documenti Markdown, con una struttura di cartelle come quella del framework (luoghi, personaggi, oggetti, sessioni);
- omonimi (due personaggi con la stessa forma), un alias dichiarato, una figura tramite, forme con apostrofi e accenti diversi;
- sessioni con titoli, corsivo narrativo, blocchi di codice, commenti HTML, tabelle e un diagramma;
- contraddizioni seminate: una data, un valore numerico (per esempio punti ferita), una relazione invertita, un luogo diverso, ciascuna a distanza di molte righe dalla seconda occorrenza;
- un’ipotesi nel file di brainstorming, presentata come ipotesi, che non deve diventare un’accusa;
- un’esclusione registrata e una fonte storica superata dal canone, che non devono essere segnalate;
- per i casi di generazione, un seme del mondo con vincoli seminati (per esempio una convenzione dei nomi o un conflitto da rispettare), senza che il vincolo sia scritto nei documenti della campagna.

La soluzione (le contraddizioni seminate, i link attesi, le decisioni attese, i vincoli da rispettare) sta in un file `key.yaml` **fuori** dalla cartella `campaign/` che l’agente può leggere. Se la chiave è visibile, il test misura la capacità di copiare, non di trovare.

## Metriche

| Metrica | Definizione | Uso |
|---|---|---|
| Copertura menzioni | menzioni eleggibili collegate correttamente / menzioni eleggibili | collegamenti |
| Precisione dei link | link corretti / link proposti | collegamenti |
| Violazioni dei contesti esclusi | link in titoli, corsivi, codice, commenti | collegamenti, da portare a zero |
| Decisioni corrette | decisioni `ASK` attese presentate, e nessuna applicata senza revisione | collegamenti |
| Recall contraddizioni | contraddizioni seminate trovate / seminate | audit |
| Falsi allarmi | rilievi su fixture pulita o su voci escluse | audit |
| Copertura dichiarata | file letti dal registro / file totali | audit |
| Esclusioni riproposte | numero di voci escluse riportate come problemi | audit, da portare a zero |
| Classificazione corretta | categorie date correttamente (contraddizione, discrepanza, prospettiva) | audit |
| Vincoli del seme rispettati | vincoli seminati rispettati nel grafo generato / vincoli seminati | generazione |
| Tempo e chiamate | run che superano il tempo massimo o il numero massimo di chiamate / run | tutte (fallimento) |
| Punteggio di qualità | griglia giudicata dal modello distinto (criteri e soglie: Proposta) | generazione |
| Stabilità | percentuale di run che danno lo stesso esito | tutte |

Valori di partenza (Proposta), da confermare dopo la prima misura: copertura menzioni almeno 95% sulla fixture; violazioni dei contesti esclusi zero; recall delle contraddizioni seminate almeno 80%; falsi allarmi sulla fixture pulita zero; esclusioni riproposte zero; stabilità almeno 2 esecuzioni su 3 concordi.

Le metriche si registrano per modello e per versione delle istruzioni, così da poter confrontare una modifica con la precedente.

## Test di regressione

- **Ad ogni rilascio:** tutti i casi di prova su tutte le fixture, con Claude. Un calo sopra la soglia di tolleranza blocca il rilascio.
- **Per ogni migrazione** (vedi [Aggiornamenti e migrazioni](Aggiornamenti%20e%20migrazioni.md)): una coppia di campagne d’esempio, prima e dopo, e il confronto con l’uscita attesa. La migrazione deve essere idempotente: eseguirla due volte non cambia nulla.
- **Ritorno indietro:** applicare una migrazione e poi il suo rollback deve riportare l’impronta dei file identica a quella iniziale.
- **Catena di versioni:** da ogni versione supportata fino all’ultima, sulla fixture, con confronto dell’esito.
- **Script:** test unitari sugli script deterministici (indice, scansione, confronto, verifica dei link), con valori di riferimento piccoli e leggibili.

Una regola generale: un test verifica un’invariante, non un conteggio che cambia con il contenuto.

### Lezioni da un test di pubblicazione

Un test per la pubblicazione di un’enciclopedia con blocchi riservati al master mostra alcune buone pratiche e alcune fragilità.

- **Buono:** il test fallisce davanti a un marcatore malformato o duplicato (il blocco riservato viene chiuso o rifiutato, non interpretato), e verifica con una scansione che nessuna riga del blocco riservato compaia nell’output pubblico. È un controllo di fuga, con una definizione precisa.
- **Buono:** il test esegue il codice effettivo della pagina (estratto dal sorgente) in un contesto controllato, con archiviazione disabilitata e risposte asincrone in ritardo. Testa il comportamento reale, non una copia.
- **Fragile:** il test fissa il numero di voci e di voci protette, e titoli precisi. Ogni nuova voce richiede di modificare il test. Un invariante del tipo «ogni voce ha uno slug univoco» non ha questo costo.
- **Fragile:** le liste di titoli attesi sono scritte a mano nel test. Converrebbe generarle dalla fixture con una chiave.

Queste lezioni portano a verificare invarianti, a usare controlli di fuga con una regola esplicita e a testare il codice effettivo. Va evitato il conteggio fisso dentro il codice di verifica.

## Feedback d’uso

La raccolta locale di dati d’uso è descritta in [Feedback d’uso](Feedback%20d’uso.md). Dalla [Riprogettazione](Riprogettazione.md) (decisione 17, 2026-11-11) la registrazione è spenta per default, e il protocollo di feedback per skill non fa parte del percorso normale (sezione 9). Il formato di evento sotto è Proposta e serve solo quando la registrazione è accesa.

- **Scopo.** Raccogliere dati che mostrano dove si perde tempo. Il registro misura soltanto: non risolve la lentezza.
- **Registro.** `.campaign/state/feedback/events.jsonl` in ogni campagna, in sola aggiunta, una riga per evento. Sta sotto `state/`, quindi non è versionato.
- **Tre tipi di evento**, una riga JSON ciascuno: `turn` (inizio della richiesta), `end` (fine, con durata, esito, modello e file scritti quando noti), `note` (auto-valutazione con esito, attrito e una frase di massimo 200 caratteri).
- **Privacy.** Il registro non contiene mai il testo del master né contenuti della campagna, nemmeno il blocco riservato. La frase di dettaglio non nomina personaggi, luoghi o testi della campagna. Valgono le regole di redazione di [Sicurezza e privacy](Sicurezza%20e%20privacy.md), sezione 3.3.

## Questioni aperte

- I valori di partenza delle soglie vanno confermati dopo la prima misura: quali accettare, e per quali parti del lavoro.
- Chi scrive la chiave della fixture e come si aggiorna quando la campagna d’esempio cambia.
- Se i casi di prova girano in automatico a ogni modifica di istruzioni, o solo a ogni rilascio, dato il costo di più esecuzioni per modello.
- **MVP (decisione dell’autore, 2026-11-07):** nell’MVP l’indice usa solo titoli e `aliases`, tutti con stato `fact`. Le forme `hypothesis` e le figure tramite si dichiarano dopo; nella fixture la figura tramite si verifica come due soggetti distinti, ciascuno collegato al proprio. Resta aperto:
  Come dichiarare nella scheda le figure tramite e lo stato delle forme (`fact` o `hypothesis`): a mano dal master, o proposte dallo script e confermate. Gli `aliases` sono la fonte dell’indice; la forma della dichiarazione per queste due informazioni non è ancora definita. *Nota (2026-11-11):* il vocabolario delle relazioni della Riprogettazione (sezione 3) non contiene la figura tramite; la domanda resta aperta per gli alias e per lo stato delle forme.
- ~~Come trattare i diagrammi Mermaid e le tabelle.~~ **Deciso (2026-11-07):** nelle tabelle si collega come nel testo; nei diagrammi Mermaid mai (stato `excluded-diagram`).
- Se il registro di copertura dell’audit debba essere conservato nella campagna o restare un file temporaneo.
- Se e come inviare il registro d’uso all’autore: un pacchetto di diagnosi con consenso e redazione (vedi [Sicurezza e privacy](Sicurezza%20e%20privacy.md), sezione 8); oggi il registro resta solo locale e spento per default. **Non deciso.**
