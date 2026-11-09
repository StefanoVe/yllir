# Aggiornamenti e migrazioni

**Stato:** Bozza di progetto
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

Questo documento descrive come il framework si aggiorna senza mettere a rischio la campagna del master. Le scelte già prese dall’autore sono indicate come tali; tutto il resto è una proposta e va letto come tale.

## Ambito

Un framework vive più a lungo di una campagna singola. Le skill migliorano, gli script cambiano, a volte cambia la forma in cui una campagna è organizzata. Il master deve poter ricevere i miglioramenti senza perdere né alterare ciò che ha scritto, e senza dover capire che cosa sia un ramo, un commit o una migrazione.

Questo file copre: il file di versione, il controllo all’avvio, la skill di update, il formato delle migrazioni, il confine fra framework, contenuti e personalizzazioni, il versionamento, la distribuzione, il ripristino dopo un errore e il changelog. Per la verifica automatica delle migrazioni e dei rilasci si rimanda a [Robustezza e test](Robustezza%20e%20test.md).

## Riferimento: Baltimora

Ciò che si sa di Baltimora, il framework di skill usato dall’autore al lavoro per i progetti Angular, è limitato:

- ha comandi in autorun che rilevano una versione vecchia del framework e chiedono se aggiornare;
- ha una skill di update che applica l’aggiornamento al progetto.

Non si sa, e va verificato con l’autore, come sia registrata la versione, quale sia l’origine dell’ultima versione pubblicata, come vengano distribuiti i file e che cosa la skill di update faccia nei casi di conflitto. Lo schema seguente è quindi una proposta costruita su quei due punti.

## File di versione

Proposta: ogni campagna contiene un file che dichiara quale versione del framework la governa, quali migrazioni ha già applicato e le impronte dei file generati dal framework. Il file sta nella radice della campagna, in una cartella nascosta dedicata al framework, così da non comparire fra i documenti.

```yaml
# .campaign/version.yaml  (forma implementata nell'MVP)
framework_version: "0.1.0"   # versione con cui sono stati generati i file
schema: 1
generated:                   # impronte dei file generati dal framework
  - path: ".campaign/instructions/agent.md"
    sha256: "..."
```

Nell'MVP non esistono migrazioni, quindi mancano `last_migration` e la data di installazione; si aggiungono con il motore delle migrazioni.

Ogni impronta (hash) è registrata al momento dell’installazione o dell’ultimo aggiornamento. Serve a sapere se un file generato è stato modificato dall’utente, cioè se è una personalizzazione (vedi [Confine](#confine-fra-framework-contenuti-e-personalizzazioni)). Le scelte di sistema di gioco e di stile non stanno qui, ma solo in `campaign.yaml` (vedi [Configurazione](Configurazione.md)). L’elenco dei file del pacchetto sta nel suo `manifest.yaml` (vedi [Architettura](Architettura.md), sezione 2).

## Controllo all’avvio

Proposta: un controllo deterministico, eseguito dall’hook di avvio della sessione, che non deve dipendere dal giudizio dell’agente.

1. Legge la versione installata da `.campaign/version.yaml`.
2. Interroga la fonte dell’ultima versione pubblicata (da decidere, vedi [Distribuzione](#distribuzione)). Se la fonte non risponde, il controllo tace e la sessione procede normalmente.
3. Se la versione pubblicata è più recente, scrive nel contesto dell’agente un’istruzione breve: presentare la novità al master in linguaggio semplice e chiedere se aggiornare, senza termini tecnici.
4. Ricorda l’ultimo avviso mostrato, così da non ripeterlo a ogni sessione. Proposta: una volta per versione, con possibilità di rimandare.

Il controllo non blocca mai l’avvio. Una verifica fallita equivale a nessuna novità.

Esempio di messaggio, pensato per chi non conosce l’informatica:

> È disponibile una versione nuova del sistema con cui lavori. Migliora il modo in cui vengono ritrovate le citazioni dei personaggi nei documenti e i controlli di coerenza. Non cambia nulla nelle tue schede e nelle tue sessioni. Vuoi che aggiorni ora? Posso prima mostrarti che cosa cambia.

Da verificare: se l’hook di avvio è disponibile in Claude Code e in Codex con lo stesso comportamento. Se non lo è, il controllo va fatto dal comando di avvio della skill principale, con lo stesso testo.

## Skill di update

Proposta: una skill dedicata che il master non chiama per nome. Viene attivata dal messaggio di risposta alla domanda sull’aggiornamento. Sequenza:

1. **Preparazione.** Crea una versione salvata git come punto di ripristino (vedi [Ripristino](#se-laggiornamento-fallisce-a-metà)) e registra la versione di partenza in `.campaign/state/update.yaml`.
2. **Lettura.** Legge le note di versione e l’elenco delle migrazioni tra la versione installata e quella di arrivo.
3. **Controllo preliminare.** Verifica che nessuno dei file da toccare abbia modifiche non salvate, che le migrazioni richiedano soltanto decisioni già registrate, e fa una prova a secco (dry run) di ciascuna migrazione, con un elenco di tutte le modifiche previste.
4. **Framework.** Sovrascrive i file del framework la cui impronta corrisponde a quella registrata. Per quelli modificati dall’utente non sovrascrive: li segnala e propone una scelta (vedi [Confine](#confine-fra-framework-contenuti-e-personalizzazioni)).
5. **Migrazioni.** Applica in ordine numerico le migrazioni non ancora registrate come completate, una alla volta, aggiornando lo stato dopo ciascuna.
6. **Verifica.** Esegue i controlli dichiarati da ogni migrazione e la suite di regressione del framework.
7. **Chiusura.** Aggiorna `.campaign/version.yaml` (versione e `last_migration`), poi presenta il riepilogo in linguaggio semplice, con l’eventuale necessità di decisioni.

Regole:

- Le migrazioni si applicano sempre in ordine, senza saltarne una: una migrazione dichiara la versione da cui parte.
- Una migrazione non si applica due volte. Eseguirla di nuovo a risultato già ottenuto non deve cambiare nulla.
- Lo script di update non prende decisioni sui contenuti. Se una migrazione incontra un conflitto che non ha una decisione registrata, si ferma su quel punto e chiede al master (vedi [Formato di una migrazione](#formato-di-una-migrazione)).

## Formato di una migrazione

Proposta: ogni migrazione è una cartella versionata, con un manifest dichiarativo, passi deterministici e una verifica.

```text
migrations/
  0004-unione-note-riservate/
    manifest.yaml
    decisions.yaml        # scelte già prese dal master, se servono
    steps/
      01_censisci.mjs
      02_unisci.mjs
      03_correggi_percorsi.mjs
      04_rimanda_link.mjs
      05_rimuovi_vuoti.mjs
    checks/
      nessun_file_separato.mjs
      link_risolvono.mjs
    rollback/
      ripristina.mjs
```

### Esempio fittizio: «Unione delle note riservate nelle schede pubbliche»

Questo esempio è inventato, costruito per illustrare il formato di una migrazione: non descrive una campagna reale. Immagina una campagna in cui le note riservate al master sono in file separati, in una cartella «Note riservate/» accanto alle schede pubbliche degli oggetti, e il framework decide di spostarle nel blocco riservato in fondo alla scheda pubblica corrispondente. Nel framework sarebbe la migrazione `0004`. Il manifest:

```yaml
# migrations/0004-unione-note-riservate/manifest.yaml  (esempio fittizio)
id: "0004-unione-note-riservate"
from_version: "1.3.0"
to_version: "1.4.0"
type: user-content              # framework | user-content | customization
reversible: true
description: >
  Ogni scheda pubblica di un oggetto ospita le proprie note riservate al master
  nel blocco finale «## Master». Le vecchie copie nella cartella «Note riservate/»
  vengono unite nella scheda corrispondente.
files_touched:
  - "Oggetti/**/Note riservate/*.md"
  - "Oggetti/**/*.md"
  - "Trama/**/*.md"
  - "Mondo/**/*.md"
  - "Creature/**/*.md"
decisions_file: "decisions.yaml"
restore_point: before          # versione salvata creata prima del primo passo
steps:
  - id: P1-censisci
    script: steps/01_censisci.mjs
    effect: nessuno              # solo elenco; nessuna scrittura
    stop_if:
      - "copia riservata senza scheda pubblica omonima"
  - id: P2-unisci
    script: steps/02_unisci.mjs
    effect: "aggiunge il blocco riservato in fondo alla scheda"
    idempotent: true             # se il blocco esiste già, non fa nulla
    stop_if:
      - "marcatori del blocco riservato già presenti o malformati"
      - "testo riservato in conflitto con il testo pubblico (vedi decisions.yaml)"
  - id: P3-correggi-percorsi
    script: steps/03_correggi_percorsi.mjs
    effect: "riduce di un livello i percorsi relativi del solo testo spostato"
  - id: P4-rimanda-link
    script: steps/04_rimanda_link.mjs
    effect: "riscrive i link verso Note riservate/<nome>.md in <scheda>.md#master"
    produces: "elenco di tutti i link riscritti, per il revisore"
  - id: P5-rimuovi-vuoti
    script: steps/05_rimuovi_vuoti.mjs
    effect: "rimuove le cartelle «Note riservate/» vuote, dopo la verifica"
checks:
  - script: checks/nessun_file_separato.mjs
    expected: "nessun file in Oggetti/**/Note riservate/"
  - script: checks/link_risolvono.mjs
    expected: "nessun link verso file inesistenti"
  - command: "suite di test del modulo enciclopedia (vedi Robustezza e test)"
    expected: "nessuna riga del blocco riservato nell’output pubblico"
rollback: "rollback/ripristina.mjs"
```

I cinque conflitti, anch’essi fittizi, diventano il file `decisions.yaml`, il che è la parte più istruttiva dell’esempio:

```yaml
# migrations/0004-unione-note-riservate/decisions.yaml  (esempio fittizio)
text_conflicts:
  - document: "Il sigillo di Nerva"
    decision: "fa fede la versione pubblica"
  - document: "Taccuino del cartografo"
    decision: "fa fede la versione riservata"
  - document: "Lanterna del molo nord"
    decision: "fa fede la versione pubblica"
  - document: "Mappa cucita in una manica"
    decision: "fa fede la versione pubblica"
  - document: "Il corno di Vallo Basso"
    decision: "fa fede la versione riservata"
```

Insegnamenti da una riorganizzazione di questo tipo, da cui derivano le regole del formato:

- **Il conflitto non si risolve da solo.** In una riorganizzazione eseguita a mano, la scelta fra testo riservato e testo pubblico, quando non coincidono, è spesso una decisione del master e non un dettaglio tecnico. La migrazione deve fermarsi su ogni conflitto senza decisione registrata, non sceglierne una.
- **Il riferimento in ingresso si cerca in tutto il repository.** Il passo 4 deve trovare i link verso la cartella delle note riservate anche in Trama, Mondo e Creature, e produrre un elenco da revisionare.
- **Le cartelle si rimuovono per ultime.** Il passo 5 gira solo dopo la verifica, e gli originali restano recuperabili dalla versione salvata prima della migrazione finché la migrazione non è registrata come completata.
- **La verifica è un’invariante, non un conteggio.** Il test di pubblicazione controlla che nessuna riga riservata compaia nell’output pubblico. Un conteggio fisso delle voci va aggiornato a mano a ogni cambio del catalogo: è fragile e non dovrebbe far parte della verifica di una migrazione.
- **Un ritorno indietro va previsto.** Una riorganizzazione eseguita a mano descrive di solito l’esecuzione e la verifica finale, ma non un percorso di ritorno. Nel framework il punto di ripristino è previsto dal manifest.

Proposta: le migrazioni con `type: framework` (solo file del framework) possono essere sempre rigenerate da zero. Quelle con `type: user-content` devono essere reversibili e dichiarare il rollback; quelle con `type: customization` non esistono, perché le personalizzazioni non si toccano mai.

## Confine fra framework, contenuti e personalizzazioni

Tre categorie, con regole diverse. La definizione di ciascuna è una proposta; la regola che le personalizzazioni non si tocchino è coerente con la decisione già presa che le regole aggiunte dall’utente vivano in un file separato (vedi [Configurazione](Configurazione.md)).

| Categoria | Esempi | Chi la possiede | Come si aggiorna | Regola |
|---|---|---|---|---|
| Framework | skill, script, template, test, istruzioni generate | il progetto del framework | sovrascritto dall’update, se l’impronta corrisponde | un file modificato dall’utente non viene sovrascritto: si propone la scelta |
| Contenuti | schede, sessioni, mondo, configurazione della campagna | il master | solo tramite migrazioni dichiarate, reversibili, con punto di ripristino | nessuna migrazione tocca un contenuto senza un passo che lo dichiari |
| Personalizzazioni | regole aggiunte dal master, file delle eccezioni, preferenze di stile | il master | mai | l’update può segnalare un’incompatibilità, non modificare il file |

Punti aperti della tabella:

- Le istruzioni per l’agente sono generate da template. Proposta: non vanno mai modificate a mano; la personalizzazione vive nel file separato, e il template lo include.
- Un file del framework modificato dall’utente (per esempio una skill con una frase cambiata) è una personalizzazione di fatto. Proposta: l’update non lo sovrascrive, crea accanto la versione nuova e mostra la differenza al master, che decide. Da decidere se la scelta si presenti sempre o solo per i file con modifiche sostanziali.
- Gli elenchi di eccezioni (come il registro delle esclusioni dell’audit) sono personalizzazioni: sono scritti dal master, e nessuna migrazione li riscrive per renderli più ordinati.

## Versionamento semantico

Proposta: il numero di versione segue la forma `MAGGIORE.MINORE.PATCH`. Il master non vede il numero, ma il changelog lo usa per decidere che cosa dire.

| Parte | Quando si incrementa | Richiede migrazione | Esempio |
|---|---|---|---|
| MAGGIORE | cambiamento incompatibile (vedi elenco) | sì, con rollback | cambia la struttura delle cartelle o il formato dei metadati delle schede |
| MINORE | nuova funzione compatibile | solo se tocca i dati | nuova skill di libreria; nuovo campo opzionale con valore di default |
| PATCH | correzione senza effetti sui dati | no | correzione di un’istruzione, di uno script o di un test |

Cosa costituisce un cambiamento incompatibile (proposta):

- rinominare o spostare una cartella o un file che il master compila;
- cambiare il formato di un file di configurazione o di un marcatore riconosciuto dagli script (per esempio il marcatore che apre il blocco riservato);
- rimuovere una skill, un comando o un parametro che il master può usare;
- cambiare il significato di un dato già registrato (un valore di una scala, un’unità);
- introdurre un obbligo di configurazione che la campagna esistente non ha.

Non è incompatibile, di per sé, cambiare il testo delle istruzioni che guidano l’agente. Un cambiamento di istruzioni che altera il formato di un report salvato, però, va trattato come cambiamento di dati. I cambiamenti di comportamento vanno comunque verificati con i casi di prova (vedi [Robustezza e test](Robustezza%20e%20test.md)): un miglioramento che fa passare un caso e ne fa fallire un altro è una regressione.

## Distribuzione

Il framework va distribuito in modo che il master non usi mai git o un terminale. Le ipotesi di distribuzione sono da verificare, non fatti.

- **Ipotesi A, plugin e marketplace di Claude Code.** Un plugin potrebbe includere skill, hook di avvio e script, e un marketplace potrebbe servire la versione pubblicata. Da verificare: se un plugin può contenere hook di sessione e script eseguibili, come si aggiorna su richiesta, se lo stesso pacchetto funziona in Codex. Non risulta ancora verificato.
- **Ipotesi B, repository con etichette di versione.** Il framework è un repository pubblico con tag di versione; l’update scarica l’ultimo tag. Funziona con entrambi gli agenti, ma richiede che il master abbia git installato, o che lo script lo gestisca in modo nascosto.
- **Ipotesi C, archivio versionato.** Un’archiviazione con un file dell’ultima versione e la sua impronta. È la più semplice e la meno dipendente dagli strumenti, ma richiede un servizio di pubblicazione.

Indipendentemente dall’ipotesi, il controllo all’avvio deve funzionare anche offline (silenzio) e la skill di update deve poter lavorare su una copia già in locale.

## Se l’aggiornamento fallisce a metà

Principio: l’aggiornamento non lascia mai il progetto in uno stato intermedio visibile al master. Proposta, in quattro livelli:

1. **Prima di cominciare.** Il framework crea una versione salvata git, che fa da punto di ripristino, e registra la versione di partenza in `.campaign/state/update.yaml`.
2. **Durante.** Ogni migrazione è registrata come `in_corso`, poi `completata` solo dopo la sua verifica. Un passo è idempotente, quindi riprenderlo non duplica nulla.
3. **Errore prima della verifica.** La migrazione torna al punto di ripristino, la registrazione passa a `annullata`, e il master vede un messaggio del tipo: l’aggiornamento non è stato applicato, nulla è cambiato.
4. **Errore dopo la verifica o ripristino fallito.** Il sistema si ferma, non tenta altro, e lascia `.campaign/state/update.yaml` con l’identificativo della versione salvata di partenza. Alla sessione successiva il controllo all’avvio trova lo stato `in_corso` e propone di riprendere o tornare com’era.

Regole aggiuntive:

- Al ritorno indietro il master usa «torna a com’era» in linguaggio naturale; la skill traduce la richiesta nel ritorno al punto di ripristino corrispondente.
- Una sola fonte per la storia dei file: le versioni salvate del framework (git sotto il cofano). Non esistono copie parallele da gestire (YAGNI e fonte unica, vedi [Principi](Principi.md)).

## Changelog leggibile

Proposta: due documenti distinti, scritti per pubblici diversi.

- **Changelog tecnico** (`CHANGELOG.md` del framework): per chi sviluppa il framework. Elenca script, skill, schemi e migrazioni, con i riferimenti ai test.
- **Novità per il master**: il testo mostrato all’utente, scritto senza termini tecnici, in tre parti: che cosa cambia per lui, se deve decidere qualcosa, se i suoi documenti vengono toccati.

Esempio di voce per il master:

> **Versione 1.4.0.** Le note riservate di ogni oggetto ora stanno nella sua scheda, in fondo, in un blocco separato. Prima erano in file a parte. Le tue schede vengono unite automaticamente; le cinque note in cui il testo riservato e quello pubblico non coincidono ti chiederò quale tenere. Nulla di ciò che è pubblico cambia.

Regole del changelog per il master: ogni voce dice se tocca i contenuti (sì/no), se richiede una decisione, e quanti documenti coinvolge. Nessuna voce che non ha un effetto per il master viene mostrata fuori dal changelog tecnico.

## Confini con il resto del framework

- La verifica dei rilasci e delle migrazioni è descritta in [Robustezza e test](Robustezza%20e%20test.md): ogni migrazione ha una coppia di campagne d’esempio, prima e dopo, e ogni rilascio è provato dalla versione più vecchia supportata fino all’ultima.
- Il ciclo di vita dei processi (per esempio la preparazione della sessione) non cambia con l’aggiornamento: le migrazioni toccano dati e file, non il flusso della sessione.
- Il modulo di configurazione (vedi [Configurazione](Configurazione.md)) è il punto in cui il master esprime le sue scelte; le migrazioni vi aggiungono campi solo con valori di default.

## Decisioni per la fetta base (2026-11-09)

Decise dall’autore:

- **Perimetro.** Nell’MVP si costruisce solo la base: `version.yaml`, controllo all’avvio, aggiornamento dei file generati della campagna. Migrazioni escluse.
- **Distribuzione.** Plugin e marketplace (ipotesi A). Il numero di versione si fissa a mano in `plugin.json`; non si usa lo SHA del commit. Si sceglie un solo posto per il numero (non anche nella voce del marketplace).
- **Avviso.** Una volta al giorno, finché il master non aggiorna. L’avviso dice chiaramente che la versione installata è obsoleta e riporta le novità per il master. **La decisione di aggiornare è sempre del master**: senza un suo sì non si aggiorna nulla.

Verificato nella documentazione di Claude Code (da rileggere prima del rilascio):

- l’aggiornamento automatico è spento di default per i marketplace di terzi;
- da script si può lanciare `claude plugin update <plugin>@<marketplace>`;
- la sessione in corso resta sulla versione vecchia: la nuova si carica al riavvio o con `/reload-plugins`;
- una sorgente non raggiungibile o un comando lento non bloccano l’avvio.

Scelte di implementazione dell’MVP, da confermare:

- **Due aggiornamenti distinti.** Il plugin lo sostituisce lo strumento; il framework aggiorna solo i file generati nella campagna, confrontando `framework_version` della campagna con quella del plugin installato. Il master vede un solo aggiornamento.
- **File generati modificati a mano.** Coerentemente con il comportamento già in uso, si ripristinano; la versione modificata resta recuperabile dalla storia git, perché prima dell’aggiornamento si salvano le modifiche pendenti. Non si creano copie accanto. Le regole del master vivono in `.campaign/customizations.md`, che non si tocca.
- **Memoria dell’avviso** in `.campaign/state/update-notice.yaml` (ultima versione avvisata, data, eventuale rinvio), non in una cartella dati del plugin: funziona anche in Codex e non dipende da una variabile d’ambiente.
- **Novità per il master** in `news/<versione>.md` (con variante `news/<versione>.<lingua>.md`) dentro il plugin pubblicato.
- **Stato dell’aggiornamento** in `.campaign/state/update.yaml` (`in_progress`, `completed`, `cancelled`), con il punto di ripristino: se resta `in_progress`, alla sessione dopo si propone di riprendere o tornare com’era.

## Questioni aperte

- Dove si trova, sul computer del master, la cartella del plugin pubblicato (la sorgente delle novità): per ora il controllo la legge dalla variabile `YLLIR_PUBLISHED_SOURCE`, e senza di essa tace. Va verificato come il marketplace la rende disponibile.
- Come si aggiorna in Codex: si usa `codex plugin marketplace upgrade yllir --json` (verificato 2026-11-09: aggiorna il plugin installato da 0.1.0 a 0.2.0). Il comando funziona solo se il marketplace è stato aggiunto da Git e non da cartella locale.
- Qual è la fonte dell’ultima versione pubblicata (plugin, repository con tag, archivio) e chi la pubblica.
- Come funziona in dettaglio la versione di Baltimora: formato del file di versione, comando di controllo, skill di update. Serve un confronto diretto con l’autore.
- Le personalizzazioni di un file del framework: scelta sempre esplicita o solo sopra una soglia di modifica.
- Quanto spesso controllare la versione: a ogni sessione, una volta al giorno, una volta per versione.
- Come gestire un’installazione che salta più versioni: applicare tutte le migrazioni in sequenza o chiedere al master se procedere.
- Se l’hook di avvio è disponibile in Codex e con quale forma; se non lo è, quale comando di avvio lo sostituisce.
- Se il changelog per il master vada tradotto in più lingue, dato che la prosa della campagna può essere in lingue diverse.
- **Migrazione «Eventi in file separati» (Proposta, 2026-11-09).** Per le campagne già create: ogni sessione `Trama/<Arco>/<Sessione>.md` diventa `Trama/<Sessione>/<Sessione>.md`, e ogni titolo `#` diventa `Eventi/<Evento>.md` con `id`, `session` e `depends_on`. Gli eventi in sequenza ricevono come `depends_on` l'evento precedente solo se il master lo conferma (l'ordine nel file non è una dipendenza). Serve che la migrazione sia reversibile, che riscriva i link alle vecchie ancore e che non tocchi il testo scritto dal master. Il file principale si genera dopo.
