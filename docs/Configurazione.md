# Configurazione della campagna

**Stato:** Bozza di progetto
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

## Scopo

Una campagna dichiara le proprie scelte in un solo file, `campaign.yaml`: identità, lingua, registro della prosa, sistema di gioco, struttura delle cartelle e stili per categoria, moduli attivi. La versione del framework non sta qui, ma in `.campaign/version.yaml`. Le istruzioni per gli agenti non si scrivono a mano: si generano da un template e da questo file. Le regole che l'utente aggiunge di propria iniziativa vivono in `.campaign/customizations.md`, che l'aggiornamento non modifica mai.

Decisioni già prese dall'autore, che questo documento rispetta:

- i file del framework si sovrascrivono all'aggiornamento; i contenuti dell'utente si toccano solo con migrazioni reversibili, le sue personalizzazioni mai.
- Il file di configurazione e le istruzioni generate da template restano **Proposta**: il resto del documento le tratta come tali.

Le chiavi del file sono in inglese (decisione dell'indice: il framework è scritto in inglese); i commenti restano in italiano.

## Principi

- **Una scelta, un solo posto.** Ogni impostazione sta in `campaign.yaml`. Le istruzioni generate la riportano ma non la ridefiniscono.
- **Il file non è il menu dell'utente.** Il master non lo apre di norma: dice in linguaggio naturale che cosa vuole, e l'agente aggiorna il file.
- **Il core conosce solo la forma.** Il valore di un sistema di gioco, di uno stile o di una categoria è dichiarato da un modulo o da un profilo. Il core verifica che il riferimento esista e che il valore sia ammesso, ma non ne conosce il contenuto.
- **Leggibile a mano, valido sempre.** Il file può essere aperto e corretto a mano, ma ogni modifica passa dal validatore prima di produrre effetti.

## Posizione nel progetto-campagna

```text
<campagna>/
  campaign.yaml                configurazione (questo documento)
  .campaign/
    version.yaml               versione del framework, ultima migrazione, impronte dei file generati
    customizations.md          regole dell'utente; l'aggiornamento non le tocca mai
    instructions/              istruzioni generate; non modificare a mano
    state/                     stato di lavoro (partite, scontri, argomenti); non è canone
    cache/                     derivati rigenerabili, per esempio l'indice dei soggetti
  Trama/ Mondo/ ...            contenuti, nelle cartelle dichiarate in campaign.yaml
```

Il pacchetto del framework (template, adattatori, profili di stile, script) sta fuori dal progetto-campagna, come descritto in [Architettura](Architettura.md). Il progetto contiene solo ciò che la campagna possiede.

## Schema di campaign.yaml

Lo schema è in YAML commentato. Ogni campo indica il tipo, se è obbligatorio e i valori ammessi. I valori tra virgolette sono esempi; quelli con `|` sono enumerazioni chiuse.

```yaml
schema: 1                        # intero, obbligatorio. Versione dello schema; cambia solo con una migrazione dichiarata.

campaign:                        # obbligatorio. Identità della campagna.
  name: testo                    # obbligatorio. Titolo mostrato all'utente e nelle intestazioni.
  slug: testo                    # obbligatorio. Solo minuscole, cifre e trattini; usato per archivi e identificatori.
  world: testo                   # facoltativo. Nome dell'ambientazione.
  description: testo             # facoltativo. Una o due frasi per il riepilogo «dove eravamo rimasti».
  created: data                  # obbligatorio. AAAA-MM-GG.

language:                        # obbligatorio.
  main: it                       # obbligatorio. Codice ISO 639-1 della lingua dei documenti di campagna.
  other: []                      # facoltativo. Lingue in cui possono esistere schede o enciclopedia.

prose:                           # obbligatorio.
  register: elevated             # obbligatorio. elevated (aulico) | plain (sobrio) | colloquial | mixed. Vale per le descrizioni narrative.
  session_format: nome           # facoltativo. Convenzione dei testi di sessione (per esempio «regole-sessione»).

system:                          # obbligatorio.
  adapter: id                    # obbligatorio. Id di un adattatore installato, oppure none.
  version: 1                     # facoltativo. Versione dell'adattatore a cui la campagna è agganciata.
  options: {}                    # facoltativo. Parametri dichiarati dall'adattatore (per esempio il metodo di difficoltà).

structure:                       # facoltativo alla creazione. Categorie di documenti; l'ordine è quello di creazione.
                                 # Una categoria compare quando nasce la prima scheda.
  - id: testo                    # obbligatorio. Id stabile, usato dai processi; non cambia con il nome della cartella.
    folder: testo                # obbligatorio. Percorso relativo alla radice della campagna.
    type: plot | chronicle | places | subjects | objects | free | notes | master-only
                                 # obbligatorio. Determina quali regole di creazione e di collegamento si applicano.
                                 # notes: spunti e bozze, non canone (Appunti/). Non entrano nell'indice dei soggetti
                                 # e non si collegano in automatico; l'audit li legge come ipotesi.
    style: id                    # facoltativo. Profilo di stile per gli artwork di questa categoria.
    cards: false                 # facoltativo. Se vero, gli oggetti producono carte illustrate.

audit:                           # facoltativo. Decisione dell'autore (2026-11-07): il registro delle esclusioni sta qui.
  exclusions:                    # rilievi che il master ha già deciso: l'audit non li ripropone.
    - subject: id                # obbligatorio. Id del soggetto.
      attribute: testo           # obbligatorio. Attributo del vocabolario dell'audit (per esempio number.depth).
      values: []                 # obbligatorio. I valori ammessi insieme (lista); un rilievo coperto non arriva al giudizio.
      reason: testo              # obbligatorio. Il motivo, con la frase del master.
      date: data                 # obbligatorio. AAAA-MM-GG.
                                 # Le voci le scrive il framework su richiesta del master; nessuna migrazione le riscrive.

modules:                         # facoltativo. Solo moduli veri, ciascuno attivabile.
  print: false                   # facoltativo. Fogli di stampa delle carte.
  encyclopedia: false            # facoltativo. Enciclopedia pubblica della campagna.
  master_screen: false           # facoltativo. Strumento grafico locale del master.
  music: false                   # facoltativo. Ricerca di sottofondi e colonne sonore.
```

Le funzioni di libreria (ingest, intrecci, mappa della trama, artwork, scontri, economia) non compaiono tra i moduli: partono quando servono. Non c'è un'opzione per i conflitti del canone: un conflitto che riguarda la modifica ferma sempre la scrittura (regola fissa, vedi [Principi](Principi.md)).

## Esempio completo: «Le maree di Calvane»

Campagna fittizia di un arcipelago di isole basse, governato da una lega di porti. Non ha alcun rapporto con altre campagne.

```yaml
schema: 1

campaign:
  name: "Le maree di Calvane"
  slug: maree-di-calvane
  world: Calvane
  description: "Un arcipelago di isole basse, governato da una lega di porti che si contendono le rotte."
  created: 2026-11-07

language:
  main: it
  other: []

prose:
  register: elevated
  session_format: regole-sessione

system:
  adapter: dnd-2024
  version: 1
  options:
    difficulty: bands-and-cr
    progression: milestone

structure:
  - id: trama
    folder: Trama
    type: plot
  - id: cronaca
    folder: Cronaca
    type: chronicle
  - id: luoghi
    folder: Mondo
    type: places
  - id: creature
    folder: Creature
    type: subjects
    style: dark-fantasy
  - id: personaggi
    folder: Personaggi
    type: subjects
    style: rotolo-dipinto
  - id: oggetti
    folder: Oggetti
    type: objects
    style: dark-fantasy
    cards: true
  - id: giocatori
    folder: Giocatori
    type: master-only

modules:
  print: false
  encyclopedia: false
  master_screen: false
  music: false
```

Il file non contiene la versione del framework: sta in `.campaign/version.yaml`. La configurazione non ha un blocco delle regole del canone e non ha un blocco separato per gli stili: lo stile di ogni categoria è in `structure[].style`, e le carte in `structure[].cards`.

## Da configurazione a istruzioni

Il generatore produce i file in `.campaign/instructions/` in questi passaggi:

1. legge `campaign.yaml` ed esegue il validatore; se fallisce, non genera nulla;
2. carica il template unico del pacchetto, nella variante per Claude (e per Codex, se attivo);
3. sostituisce i segnaposto con i valori della configurazione (nome, lingua, registro, cartelle delle categorie, adattatore, stili);
4. include le sezioni condizionate ai moduli attivi: per esempio la sezione della stampa compare solo con `modules.print: true`. Le funzioni di libreria non hanno sezioni condizionate;
5. inserisce le regole di processo fisse del framework (audit di continuità prima di ogni modifica, collegamenti dopo, derivati aggiornati), che non dipendono dalla campagna e non sono modificabili dalla configurazione;
6. aggiunge il rimando a `.campaign/customizations.md`, che l'agente legge insieme alle istruzioni;
7. scrive il file con un'intestazione che dichiara che è generato e indica dove fare le modifiche;
8. registra in `.campaign/version.yaml` un'impronta del file generato, così il validatore rileva le modifiche fatte a mano.

**Proposta:** il template è unico e produce varianti per Claude e, se attivo, per Codex. Codex riceve istruzioni più esplicite sugli stessi passaggi, come chiede la decisione sulla robustezza delle skill. Le due varianti derivano dallo stesso testo, così una regola non può esistere in una e mancare nell'altra.

## File delle personalizzazioni

`.campaign/customizations.md` raccoglie le regole che l'utente ha dato a parole, per esempio «non usare mai la parola X» o «nei dialoghi del porto il tono è ruvido». Non è un duplicato della configurazione:

- la configurazione contiene scelte strutturate e verificabili;
- le personalizzazioni contengono indicazioni libere, datate e spiegate con la frase dell'utente.

Regole d'uso (proposta):

- l'agente aggiunge una voce in fondo al file, con data e frase originale, quando l'utente lo chiede;
- l'aggiornamento del framework non apre questo file in scrittura, mai: può leggerlo solo per segnalare un conflitto con il nuovo template;
- se una personalizzazione contraddice il template, prevale la personalizzazione e il validatore lo segnala come avviso.

## Chi modifica la configurazione

L'utente parla, l'agente traduce. Un esempio:

> Utente: «Vorrei che le descrizioni nelle sessioni fossero più asciutte.»
> Agente: cambia `prose.register` da `elevated` a `plain`, rigenera le istruzioni, valida il file e risponde: «Ho cambiato il registro delle descrizioni. Le sessioni già scritte non cambiano.»

Le modifiche si dividono in tre classi, con un trattamento diverso:

| Classe | Esempi | Trattamento |
| --- | --- | --- |
| Preferenza | registro, lingua di un documento, personalizzazione | applicata subito, con conferma in una frase |
| Struttura | nuova categoria, spostamento o rinomina di una cartella | piano di migrazione mostrato in linguaggio semplice, conferma, migrazione reversibile |
| Sistema o stile | cambio di adattatore o di profilo | conferma esplicita e elenco delle schede che ne risentono; nessuna riscrittura automatica |

Se la richiesta non corrisponde a una voce dello schema, l'agente non inventa un campo: la annota in `.campaign/customizations.md` e lo dice all'utente.

## Validazione

La validazione è uno script deterministico, non un giudizio dell'agente. Controlla:

- la presenza dei campi obbligatori (`schema`, `campaign`, `language`, `prose`, `system`) e i valori degli enumerativi;
- il formato di `campaign.slug`, `campaign.created` e `language.main`;
- l'unicità degli `id` di categoria e l'esistenza delle cartelle dichiarate in `structure` (solo quelle: il validatore non controlla altro);
- l'esistenza dell'adattatore e dei profili di stile citati;
- la coerenza delle carte: `cards: true` ha senso solo su una categoria di tipo `oggetti`;
- la compatibilità fra la versione del framework in `.campaign/version.yaml` e la versione installata;
- l'impronta dei file generati in `.campaign/version.yaml`, per rilevare modifiche a mano.

Il validatore viene eseguito all'avvio, dopo ogni modifica alla configurazione e prima di ogni generazione. Il suo output è in linguaggio semplice («La cartella Creature non esiste: la creo o la indichi?»), non in messaggi di errore grezzi. I casi di prova (file valido, campo mancante, enumerativo errato, cartella inesistente, profilo sconosciuto) fanno parte della verifica descritta in [Robustezza e test](Robustezza%20e%20test.md).

## Questioni aperte

- **Nomi dei file in `.campaign/instructions/`.** Va deciso se usare un nome unico per tutti gli agenti o uno per ciascuno.
- **Enumerativi chiusi o aperti.** Per `prose.register` e `structure[].type` la proposta è un elenco chiuso; resta da decidere chi può aggiungere valori e come.
- **Gerarchia dei luoghi.** La configurazione dichiara solo le categorie. Non è deciso se anche la gerarchia di `Mondo` (continente, regione, luogo) debba essere descritta nel file o ricavata dalle cartelle.
- **Lingue secondarie.** Non è deciso se una campagna possa avere enciclopedia o schede in più lingue e come si collegano.
- **Wrapper per Claude e Codex.** **Deciso (2026-11-07):** nella radice della campagna il generatore scrive `CLAUDE.md` e `AGENTS.md` brevi, che rimandano soltanto a `.campaign/instructions/`, l'unica fonte, e a `.campaign/customizations.md`.
- **Regole di processo fisse.** L'elenco delle regole che il template impone, e che la configurazione non può disattivare, va confrontato con [Processi di core](Processi%20di%20core.md) prima di essere fissato.
