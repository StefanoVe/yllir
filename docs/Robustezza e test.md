# Robustezza e test

**Stato:** Bozza di progetto
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

Questo documento raccoglie i problemi di affidabilità dichiarati dall’autore nelle skill di collegamento e di audit, i modi di fallimento che si possono ipotizzare per skill di questo tipo, e la proposta per renderli misurabili e ripetibili. I modi di fallimento sono ipotesi generali: nessuno è stato riprodotto in modo controllato. Le proposte si basano sul principio che la parte meccanica di una skill sia uno script e la parte di giudizio sia dell’agente.

## Scopo

Una skill è affidabile quando lo stesso lavoro produce lo stesso esito indipendentemente da quale modello lo esegue e da quante volte viene eseguito. Nelle prime versioni delle skill questo non avviene. Il framework deve poter dire, per ogni skill, quanto spesso sbaglia e in quale modo, e deve poter dimostrare che una modifica alle istruzioni migliora davvero.

## Problemi dichiarati dall’autore

- **La skill dei collegamenti collega alcune menzioni ma non tutte.** L’istruzione di collegare «ogni menzione» è presente nelle istruzioni della skill, ma non è verificata da nulla.
- **L’audit di continuità non segnala quasi mai nulla, eppure gli errori capitano.** L’audit è eseguito prima di ogni modifica, come richiesto dalle istruzioni dell’agente, quindi un falso negativo produce un errore nel documento.
- **Codex ha bisogno di istruzioni più esplicite di Claude.** Osservazione dell’autore sui modelli: le istruzioni del framework devono funzionare con entrambi.

## Modi di fallimento noti

Le voci seguenti derivano dalla lettura delle istruzioni di collegamento e di audit. Ciascuna descrive un modo generico in cui una skill di questo tipo può fallire, e la contromisura che il framework adotta. Il livello di confidenza indica quanto l’ipotesi sia sostenuta dai file, non quanto sia dimostrata.

| ID | Modo di fallimento | Come si presenta | Contromisura del framework | Confidenza |
|---|---|---|---|---|
| F1 | La skill dei collegamenti perde candidati | Un passaggio deterministico che enumerava i candidati scompare in una modifica, e le istruzioni che lo richiamavano non vengono aggiornate. Il controllo ricade sulla sola lettura del modello. | L’enumerazione delle occorrenze è affidata a uno script deterministico (vedi [Indice dei soggetti](#indice-dei-soggetti)). La rimozione di uno script è una modifica del framework che passa dai test di regressione. | Media (la perdita del passaggio è verificabile; l’effetto sulla qualità è ipotesi) |
| F2 | Riferimenti a strumenti inesistenti | Una skill cita uno strumento, un grafo o un comando che non esiste più. L’agente tenta di usarlo, oppure salta il passo senza dirlo. | Un controllo verifica che ogni strumento, script o comando citato nelle istruzioni esista nel pacchetto, e fallisce altrimenti. | Alta (il riferimento si verifica con una ricerca); media (l’effetto dipende dal modello) |
| F3 | Nessun inventario dei soggetti | Il passo che chiede di «costruire una mappa di nomi» non ha un elenco prodotto da uno script, con alias e forme ortografiche. Trovare ogni menzione richiede di ricordare decine di occorrenze in documenti lunghi, e le occorrenze ripetute nelle pagine lunghe sono le prime a sfuggire. | Un indice dei soggetti derivato dagli `aliases` delle schede, con le forme da cercare. | Media |
| F4 | Eccezioni non definite con precisione | Le esclusioni (titoli, corsivi narrativi, blocchi di codice, commenti) sono elencate a parole. Tabelle, diagrammi e le etichette dei nodi non sono citati, e il modello deve riconoscere a occhio la sintassi di ogni eccezione. Un diagramma è una zona grigia che può essere trattata in modi diversi a ogni esecuzione. | Eccezioni sintattiche documentate e applicate dallo script, con stati espliciti (vedi [Scansione e stati delle occorrenze](#scansione-e-stati-delle-occorrenze)). Ogni tipo di blocco ha un caso di prova. | Media |
| F5 | Esiti che escludono il link | Il percorso di minor resistenza è omettere: la maggior parte degli esiti impedisce di applicare il link, e il revisore, che opera in sola lettura, tende a non approvare ciò che non può verificare fino in fondo. Le istruzioni chiedono inoltre di collegare solo «corrispondenze sostanziali» e di non collegare «parole generiche», criteri che lasciano spazio all’omissione. | Esiti con campo di evidenza obbligatorio, rapporto che elenca le omissioni con il motivo, e una metrica di copertura che rende visibile il costo di omettere. | Media |
| F6 | Audit che non trova nulla | L’audit chiede di leggere tutti i file, che in un archivio grande sono molti. Le istruzioni sono prevalentemente negative. Un agente che legge una frazione dei file e ha istruzioni negative tende al silenzio, e il silenzio non è distinguibile da un controllo completo, perché l’audit non produce un registro di copertura. | Un registro di copertura generato da script. Una dichiarazione di «nessun problema» senza registro è invalida. | Alta per la copertura non verificabile; media per l’effetto negativo |
| F7 | Confronto in prosa | L’audit confronta fatti in forma narrativa. Una contraddizione fra due frasi distanti non viene estratta né confrontata in modo sistematico. | Estrazione dei fatti in forma strutturata e confronto meccanico (vedi [Audit con fatti strutturati](#audit-con-fatti-strutturati)). | Media |
| F8 | Ambito dell’audit non definito | Nessuna regola restringe l’audit ai soggetti toccati dalla modifica. Se l’ambito è troppo ampio non viene eseguito a fondo; se è troppo stretto perde le contraddizioni a distanza. | Due modalità distinte: un audit pre-modifica mirato e un audit completo su richiesta. | Media |
| F9 | Istruzioni condizionali in prosa | Formule come «se disponibile», «quando possibile», «altrimenti uno strumento consentito» vengono risolte saltando il ramo più costoso. Il file di metadati di un agente contiene solo la policy di invocazione, senza istruzioni operative. | Regole di scrittura con default esplicito e comando esatto per ogni agente (vedi [Istruzioni per Claude e Codex](#istruzioni-per-claude-e-codex)). | Media |
| F10 | Revisione non verificabile | Il revisore riceve proposte, estratti e percorsi, ma non un formato di evidenza fisso, e il suo esito è una valutazione libera. Due revisioni della stessa proposta possono dare esiti diversi senza che nulla lo riveli. | Un formato di evidenza fisso per ogni voce, con localizzatore obbligatorio, validato dallo script. | Media |

### Misurare prima di fissare soglie

Un conteggio grezzo delle occorrenze di un soggetto, per sottostringa e senza confini di parola, include titoli, diagrammi, blocchi di codice e le esclusioni dichiarate. È quindi un limite superiore del numero di menzioni non collegate, non il numero di errori: un nome che compare cento volte in una cartella di sessioni può avere molte occorrenze dentro titoli o blocchi di codice.

Un conteggio come questo non misura la qualità dei collegamenti. Serve come base per la metrica di copertura, cioè il numero di menzioni eleggibili collegate correttamente, con la stessa definizione di eleggibile applicata a tutti i run.

## Principio: deterministico per il meccanico, agente per il giudizio

Proposta: ogni skill si divide in tre strati.

```text
1. Script deterministico   trova, conta, confronta, verifica (sempre uguale a ogni run)
2. Agente                  decide solo i casi che lo script ha marcato come ambigui
3. Revisore                secondo giudizio su ciò che l’agente propone, con formato di evidenza fisso
```

Lo script produce un rapporto completo; l’agente riceve l’elenco ridotto ai casi da decidere; il revisore riceve le evidenze in forma strutturata. Ogni strato lascia un file, così la sua uscita si può confrontare con quella di un altro modello.

Ciò che deve essere deterministico: l’individuazione delle menzioni, l’applicazione delle eccezioni sintattiche, la verifica che un link risolva, il confronto dei valori, il conteggio dei file letti. Ciò che resta all’agente: decidere se una somiglianza è un’identità, se due prove sono davvero in conflitto, se un’ipotesi del brainstorming diventa un fatto.

## Indice dei soggetti

Proposta: uno script genera l’indice dei soggetti in `.campaign/cache/subjects.json` a partire dagli `aliases` delle schede. Ogni forma nasce da un alias o dal titolo di una scheda; l’indice è derivato, si ricostruisce dai file e si può cancellare. Non si scrive a mano. Con questo indice la skill dei collegamenti non cerca più i nomi a memoria: li trova tutti.

### Forma dell’indice

Esempio fittizio, con la campagna d’esempio «Le maree di Calvane». È la struttura generata, con chiavi in inglese:

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

- **Alias e figura tramite non sono la stessa cosa.** Un alias dichiara che due forme indicano lo stesso soggetto. Una figura tramite dichiara che un soggetto agisce attraverso un altro senza esserlo. In una campagna può capitare che una divinità pregata sia il volto di un’altra entità, o che un personaggio parli a nome di un’istituzione senza esserne l’istituzione. L’indice deve poter registrare la relazione senza fonderla in un’identità, perché la skill dei collegamenti non deve mai collegare due soggetti come se fossero uno.
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
| `to-decide` | in una tabella o in un diagramma Mermaid | decisione dichiarata una volta per tipo di blocco |

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

La copertura dei collegamenti è misurabile: menzioni eleggibili collegate correttamente divise per menzioni eleggibili (le `bare`, le `linked` e le `ambiguous` risolte). Il rapporto può essere confrontato fra un run e l’altro, e fra Claude e Codex.

## Collegamenti con indice

Sequenza proposta:

1. Lo script di indice e scansione genera il rapporto per l’insieme di file richiesto.
2. Lo script raggruppa le proposte in tre elenchi: link da applicare (`bare` con soggetto `fact`), link da revisionare (`ambiguous`, `linked-elsewhere`), decisioni (`to-decide`).
3. L’agente prepara per ogni voce un testo prima e dopo, la destinazione relativa, e il motivo in una frase.
4. Il revisore, con formato di evidenza fisso (vedi sotto), approva, corregge, omette o chiede conferma.
5. Uno script applica i link approvati, rispettando le eccezioni, e rigenera il rapporto: le menzioni `bare` residue devono essere zero oppure elencate con il motivo.
6. La verifica controlla che i percorsi risolvano, che i frammenti `#ancora` corrispondano a titoli esistenti e che il numero di blocchi di codice non sia cambiato.

Il formato di evidenza del revisore è una riga per voce, con campi fissi: `id`, `file`, `occurrence`, `target`, `evidence` (localizzatore della scheda o della fonte), `outcome` (uno degli esiti della scala definita in [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md)) e `reason` (una frase). Un esito senza localizzatore non è valido, e lo script lo rifiuta.

### Regole per le identità

- Un link a una scheda è sempre consentito quando la menzione è esplicita e la forma è `fact`.
- Una somiglianza, un omonimo o una figura tramite non producono mai un link automatico. Producono una decisione.
- Un’identità nuova non è mai scritta dalla skill dei collegamenti: se la campagna la stabilisce, va registrata nella scheda o nell’indice dal master.

## Audit con fatti strutturati

Il modo di fallimento F6 nasce dal chiedere all’agente di leggere tutto e di segnalare ciò che non torna. Proposta: estrarre prima i fatti in forma strutturata, confrontarli con uno script, e lasciare all’agente la classificazione.

### Ambito

Due modalità distinte, con regole diverse:

- **Pre-modifica.** Ambito ristretto ai soggetti toccati dalla modifica (ricavati dall’indice) e ai documenti che li citano, più le schede che li definiscono. È l’audit che la sequenza di scrittura richiede prima di ogni modifica (vedi [Processi di core](Processi%20di%20core.md#regole-comuni)).
- **Completo.** Ambito tutto il repository, eseguito su richiesta o a intervalli. Produce un registro di copertura per ogni file.

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

## Istruzioni per Claude e Codex

Le istruzioni del framework devono funzionare con Claude e, quando è attivo, con Codex (che è facoltativo). Regole di scrittura proposte, in base ai modi di fallimento F9 e F6:

1. **Passi numerati, ciascuno con un file di uscita nominato.** Il passo successivo legge quel file, non la memoria del passo precedente.
2. **Nessuna condizione senza default.** Non «se disponibile, usa X». Scrivere «usa X; se il comando fallisce, scrivi il motivo in `outcomes.md` e ferma il passo».
3. **Strumenti nominati per ogni agente.** Per Claude e per Codex, il comando esatto (per esempio il percorso dello script e gli argomenti) è scritto nelle istruzioni, non descritto.
4. **Criterio di fine verificabile.** «Termina quando il registro di copertura elenca tutti i file con stato diverso da `to-read`» è verificabile; «leggi tutto» no.
5. **Formato di output fisso,** con un esempio corretto e uno sbagliato.
6. **Affermazioni positive.** Limitare i divieti a quelli che servono davvero, e ogni divieto accompagnato dalla cosa da fare al suo posto.
7. **Istruzioni brevi per ciascun modello.** Le istruzioni più lunghe vanno divise in file richiamati dai passi, così che un modello non debba trattenere l’intero documento.

Da verificare: quale lunghezza e struttura Codex segue con più affidabilità. Le prove sono da fare con i casi di prova (vedi sotto), non dedotte.

## Casi di prova

Proposta: per ogni skill esiste una cartella di casi in `tests/`, con una campagna d’esempio, una richiesta e un esito atteso.

```text
tests/
  linker/
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
# tests/linker/multiple-mentions/expected.yaml  (esempio)
case: linker-multiple-mentions
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
- **Audit:** contraddizione diretta fra due schede a distanza; discrepanza di prospettiva non classificata come errore; esclusione registrata non riproposta; fonte storica superata dal canone attuale non segnalata come problema; ipotesi del brainstorming non presentata come contraddizione; audit pre-modifica che non tocca documenti estranei.
- **Generale:** l’agente non modifica file in modalità sola analisi; l’agente non prende decisioni che il rapporto dichiara da chiedere; ogni strumento citato nelle istruzioni esiste (vedi la tabella dei modi di fallimento, F2).

### Esecuzione con Claude e, se attivo, con Codex

Lo stesso caso viene eseguito con ogni agente previsto, con le stesse istruzioni e la stessa campagna copiata. Uno script per agente avvia l’esecuzione e raccoglie l’uscita. Il confronto è fatto sull’esito dello script di verifica e sull’atteso, non sul giudizio di chi ha eseguito il caso.

- Ogni caso si esegue più volte (proposta: tre), perché i modelli non sono deterministici. Il risultato è la percentuale di esecuzioni in cui il caso passa, non un singolo passaggio.
- Il risultato è registrato con modello, versione, data e impronta delle istruzioni. Quando cambiano le istruzioni, il risultato precedente non vale più.
- Le esecuzioni con Codex e quelle con Claude sono confrontabili solo sugli stessi casi e sulle stesse fixture.

Da verificare: come si integri uno script di esecuzione con l’esecuzione non interattiva di Codex. Nella descrizione dello strumento di guida per Claude Code compaiono `claude plugin eval` e `/skill-doctor`; se fanno ciò che serve, potrebbero coprire parte della proposta. Non è verificato.

### Scoring

- Il più possibile deterministico: lo script di verifica controlla link, eccezioni rispettate, file modificati, file non toccati.
- Per gli esiti in linguaggio naturale (classificazioni dell’audit), una rubrica con voci binarie: il localizzatore è presente, la categoria è quella attesa, l’esclusione non è riproposta.
- Il giudice non è l’agente che ha prodotto l’esito. Proposta: un secondo run, con un modello diverso, sulla sola rubrica.

## Fixture di campagna d’esempio

Proposta: una campagna d’esempio sintetica, costruita apposta per il test, senza elementi di una campagna reale né di un sistema di gioco specifico. Serve perché i casi di prova non si eseguano sulla campagna reale, che cambia e non ha una risposta nota.

Caratteristiche minime:

- circa trenta documenti Markdown, con una struttura di cartelle come quella del framework (luoghi, personaggi, oggetti, sessioni);
- omonimi (due personaggi con la stessa forma), un alias dichiarato, una figura tramite, forme con apostrofi e accenti diversi;
- sessioni con titoli, corsivo narrativo, blocchi di codice, commenti HTML, tabelle e un diagramma;
- contraddizioni seminate: una data, un valore numerico (per esempio punti ferita), una relazione invertita, un luogo diverso, ciascuna a distanza di molte righe dalla seconda occorrenza;
- un’ipotesi nel file di brainstorming, presentata come ipotesi, che non deve diventare un’accusa;
- un’esclusione registrata e una fonte storica superata dal canone, che non devono essere segnalate.

La soluzione (le contraddizioni seminate, i link attesi, le decisioni attese) sta in un file `key.yaml` **fuori** dalla cartella `campaign/` che l’agente può leggere. Se la chiave è visibile, il test misura la capacità di copiare, non di trovare.

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
| Stabilità | percentuale di run che danno lo stesso esito | tutte |

Valori di partenza, da confermare dopo la prima misura: copertura menzioni almeno 95% sulla fixture; violazioni dei contesti esclusi zero; recall delle contraddizioni seminate almeno 80%; falsi allarmi sulla fixture pulita zero; esclusioni riproposte zero; stabilità almeno 2 esecuzioni su 3 concordi.

Le metriche si registrano per modello e per versione delle istruzioni, così da poter confrontare una modifica con la precedente.

## Test di regressione

- **Ad ogni rilascio:** tutti i casi di prova su tutte le fixture, con Claude e, se attivo, con Codex. Un calo sopra la soglia di tolleranza blocca il rilascio.
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

## Questioni aperte

- I valori di partenza delle soglie vanno confermati dopo la prima misura: quali accettare, e per quali skill.
- Chi scrive la chiave della fixture e come si aggiorna quando la campagna d’esempio cambia.
- Se i casi di prova girano in automatico a ogni modifica di istruzioni, o solo a ogni rilascio, dato il costo di più esecuzioni per modello.
- Come dichiarare nella scheda le figure tramite e lo stato delle forme (`fact` o `hypothesis`): a mano dal master, o proposte dallo script e confermate. Gli `aliases` sono la fonte dell’indice; la forma della dichiarazione per queste due informazioni non è ancora definita.
- Come trattare i diagrammi Mermaid e le tabelle: esclusi per regola, oppure controllati con un passo a parte.
- Se il registro di copertura dell’audit debba essere conservato nella campagna o restare un file temporaneo.
