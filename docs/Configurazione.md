# Configurazione della campagna

**Stato:** Bozza di progetto
Riscritto dopo la [Riprogettazione](Riprogettazione.md) (2026-11-11).
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

## Scopo

Una campagna dichiara le proprie scelte in un solo file, `campaign.yaml`: identità, lingua, registro della prosa, sistema di gioco, struttura delle cartelle e stili per categoria, moduli attivi. La descrizione dell'ambientazione non sta più qui: sta nel **seme del mondo**, un documento a sé (vedi «Il seme del mondo» più sotto). La versione del framework non sta qui, ma in `.campaign/version.yaml`. Le istruzioni per gli agenti non si scrivono a mano: si generano da un template e da questo file. Le regole che l'utente aggiunge di propria iniziativa vivono in `.campaign/customizations.md`, che l'aggiornamento non modifica mai.

Decisioni già prese dall'autore, che questo documento rispetta:

- i file del framework si sovrascrivono all'aggiornamento; i contenuti dell'utente si toccano solo con migrazioni reversibili, le sue personalizzazioni mai.
- Il file di configurazione e le istruzioni generate da template restano **Proposta**: il resto del documento le tratta come tali.
- **Implementato in 0.30.0.** La chiave `allow_model_imagination` non decide più nulla (vedi «Fantasia del modello (superata)»): il validatore la accetta con qualunque valore e la migrazione la rimuove.
- **Implementato in 0.30.0.** Il framework si distribuisce solo come plugin per Claude Code (decisione 11 della [Riprogettazione](Riprogettazione.md)); non esistono più istruzioni o template per Codex.

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
  Seme del mondo.md            seme del mondo: il nome del file sta in campaign.seed
  .campaign/
    version.yaml               versione del framework, ultima migrazione, impronte dei file generati
    customizations.md          regole dell'utente; l'aggiornamento non le tocca mai
    instructions/              istruzioni generate; non modificare a mano
    state/                     stato di lavoro: nota sul lavoro in corso, trascrizioni del feedback se attive; non è canone
    drafts/                    bozze del lotto in corso; non sono canone e sono escluse da Git
    cache/                     derivati rigenerabili: indice dei soggetti e indice del mondo
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
  seed: testo.md                 # facoltativo nello schema; presente in ogni campagna creata o migrata. Nome del file del seme del mondo, nella radice della campagna. Deve finire con .md, essere relativo, senza .. né barre rovesciate.
  created: data                  # obbligatorio. AAAA-MM-GG.
  description: testo             # superata, accettata solo per compatibilità. Non si scrive più: la descrizione sta nel seme (campaign.seed). La migrazione la sposta nel seme e la toglie.

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
    type: plot | chronicle | places | subjects | objects | free | notes | sources | external | master-only
                                 # obbligatorio. Determina quali regole di creazione e di collegamento si applicano.
                                 # subjects: personaggi, creature e fazioni.
                                 # notes: spunti e bozze, non canone (Appunti/). Non entrano nell'indice dei soggetti
                                 # e non si collegano in automatico; l'audit li legge come ipotesi.
                                 # sources: originali acquisiti (foto, PDF, scansioni) con trascrizione e scheda di acquisizione, scritti dall'ingest. Non entrano nell'indice dei soggetti e non si collegano in automatico; l'audit li legge come ipotesi.
                                 # external: documenti di un'altra campagna o di materiale condiviso, in sola lettura: canone per audit e ricerca, destinazione dei link per il linker. Non vengono mai modificati. Vedi Fonti esterne.
    style: id                    # facoltativo. Profilo di stile per gli artwork di questa categoria.
    cards: false                 # facoltativo. Se vero, gli oggetti producono carte illustrate.
    exclude: []                  # facoltativo, solo con type external. Percorsi (file o cartelle, relativi alla cartella, con /) che non vengono indicizzati.

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

allow_model_imagination: null    # accettata e ignorata (Implementato in 0.30.0). Qualunque valore è accettato; la migrazione la toglie. Vedi sotto.
```

Le funzioni di libreria (ingest, intrecci, mappa della trama, artwork, scontri, economia) non compaiono tra i moduli: partono quando servono. Non c'è un'opzione per i conflitti del canone: un conflitto che riguarda la modifica ferma sempre la scrittura (regola fissa, vedi [Principi](Principi.md)).

Una chiave che non appartiene allo schema è un errore di validazione. In particolare la trascrizione del feedback non si accende da qui (vedi «Trascrizioni del feedback»).

### Fantasia del modello (superata)

**Superata dalla Riprogettazione (decisione 7, 2026-11-11).** Il framework inventa ciò che le fonti non danno e lo dichiara al master: la regola di provenienza (sezione 6 della [Riprogettazione](Riprogettazione.md)) sostituisce il blocco della fantasia. Non esistono più i valori `null`, `true` e `false`, né la domanda a quattro risposte.

**Implementato in 0.30.0.** La chiave `allow_model_imagination` non viene più letta: il validatore la accetta con qualunque valore e la migrazione post-update la rimuove dal file. Resta nello schema solo per non far fallire le campagne che la contengono ancora.

### Il seme del mondo

**Implementato in 0.30.0.** Il seme è un documento Markdown nella radice della campagna, con il nome dichiarato da `campaign.seed` (in italiano `Seme del mondo.md`, in inglese `World seed.md`). Sostituisce `campaign.description`: la frase unica di descrizione diventa un documento che cresce con il mondo.

Il seme raccoglie, in sezioni con titolo `###`:

- genere e tono;
- temi;
- conflitti centrali;
- fazioni;
- culture;
- convenzioni dei nomi;
- livello di potere;
- calendario;
- cose da evitare.

Tutto il suo contenuto sta nel blocco riservato al master ([Formato dei contenuti](Formato%20dei%20contenuti.md)), perché descrive il canone e non il testo pubblico. Il seme è sempre nel contesto del lavoro: ogni scelta sul mondo deve accordarsi con lui. Cresce da solo: quando il master aggiunge un'informazione che vale per tutto il mondo, o quando il framework genera un pezzo di mondo, il seme riceve la parte che vale per il tutto (una fazione, una convenzione dei nomi, un tema). Il master lo corregge in qualunque momento, parlando.

Il disegno è nella [Riprogettazione](Riprogettazione.md), sezione 4.

### Fonti esterne

**Deciso** (2026-11-09, scelta dell'autore).

Una categoria con `type: external` punta a una cartella che non appartiene a questa campagna: di solito un collegamento simbolico a una cartella di un'altra campagna o di materiale condiviso, per esempio il mondo comune a più campagne. È una scelta facoltativa: una campagna senza categorie `external` si comporta come prima.

I documenti di una fonte esterna sono canone di questa campagna in sola lettura. L'audit di continuità e la ricerca nel canone li leggono e li confrontano con i documenti della campagna: una contraddizione fra un documento della campagna e uno esterno è un errore reale. La ricerca dichiara quando una prova viene dal mondo condiviso. Non vengono mai modificati: né l'audit né la ricerca propongono di cambiarli, e quando un documento esterno non torna con uno della campagna, da correggere è il documento della campagna. Il linker li usa solo come destinazione: il linker può proporre un link da una menzione nei documenti della campagna verso uno di questi documenti, e non cerca mai menzioni al loro interno.

Non serve il frontmatter. L'identificativo si ricava senza riscrivere il file: `<id della categoria>:<percorso nella cartella, senza .md>`, per esempio `mondo-condiviso:Luoghi/Raatnagar`. Se il documento ha un `id` nel frontmatter, l'identificativo è `<id della categoria>:<quell'id>`. Il titolo è il primo titolo di primo livello, o il nome del file senza `.md`; gli alias sono letti dal frontmatter solo se presenti.

La chiave facoltativa `exclude` elenca file o cartelle, relativi alla cartella, che non vengono indicizzati: serve a lasciare fuori i documenti che non devono essere destinazioni di collegamenti. La scansione segue i collegamenti simbolici, visita ogni cartella e ogni file reale una sola volta (così non si entra in cicli) e salta in silenzio i collegamenti rotti.

Due documenti con lo stesso titolo (nella stessa cartella esterna, in due cartelle esterne, o uno esterno e uno della campagna) sono omonimi: il linker non li collega mai in automatico e li mette in revisione per il master, come ogni omonimo. I link passano attraverso il collegamento simbolico: il percorso nel link è quello dentro la cartella della campagna, non quello reale.

### Categoria delle fazioni

**Implementato in 0.30.0.** Le fazioni hanno una propria categoria, con id `fazioni` (in inglese `factions`), cartella `Fazioni` e tipo `subjects`. Non si dichiara a mano: la crea il processo di costruzione del mondo alla prima fazione, e da quel momento compare in `structure` come le altre categorie.

## Trascrizioni del feedback

**Deciso** (decisione 17 della [Riprogettazione](Riprogettazione.md), 2026-11-11). Le trascrizioni locali del feedback sono **spente per default**. Si accendono solo in sviluppo o quando il master lo chiede. Modifica la scelta dell'indice, che le prevedeva per ogni uso di skill.

**Implementato in 0.30.0.** Non è una chiave di `campaign.yaml`: il file non la accetta. Si accendono in uno di questi due modi:

- con la variabile d'ambiente `YLLIR_FEEDBACK=1`, usata in sviluppo e dal testbench;
- con il file `.campaign/state/feedback/on`, che esiste quando il master ha chiesto le trascrizioni.

Con nessuno dei due, nulla viene registrato. Le trascrizioni e i dettagli restano nella cartella di feedback, senza invio di rete (vedi [Feedback d'uso](Feedback%20d’uso.md)).

**Proposta.** Chi crea il file `on` quando il master lo chiede, e come lo spegne, non è ancora descritto: lo fa l'agente, in una frase.

## Esempio completo: «Le maree di Calvane»

Campagna fittizia di un arcipelago di isole basse, governato da una lega di porti. Non ha alcun rapporto con altre campagne.

```yaml
schema: 1

campaign:
  name: "Le maree di Calvane"
  slug: maree-di-calvane
  world: Calvane
  seed: Seme del mondo.md
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
  - id: fazioni               # creata da build-world alla prima fazione
    folder: Fazioni
    type: subjects
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

Il file non contiene la versione del framework: sta in `.campaign/version.yaml`. La configurazione non ha un blocco delle regole del canone e non ha un blocco separato per gli stili: lo stile di ogni categoria è in `structure[].style`, e le carte in `structure[].cards`. La descrizione dell'ambientazione sta nel seme, `Seme del mondo.md`.

## Da configurazione a istruzioni

Il generatore produce i file in `.campaign/instructions/` in questi passaggi:

1. legge `campaign.yaml` ed esegue il validatore; se fallisce, non genera nulla;
2. carica il template unico del pacchetto, `templates/instructions.md` (**Implementato in 0.30.0**: un solo template, per Claude Code);
3. sostituisce i segnaposto con i valori della configurazione (nome, lingua, registro, cartelle delle categorie, adattatore, stili);
4. include le sezioni condizionate ai moduli attivi: per esempio la sezione della stampa compare solo con `modules.print: true`. Le funzioni di libreria non hanno sezioni condizionate;
5. inserisce le regole di processo fisse del framework (revisione della bozza canonica rispetto ai documenti di contesto, collegamenti dopo, derivati aggiornati), che non dipendono dalla campagna e non sono modificabili dalla configurazione; gli audit di continuità partono dai processi che li richiamano esplicitamente;
6. aggiunge il rimando a `.campaign/customizations.md`, che l'agente legge insieme alle istruzioni;
7. scrive il file con un'intestazione che dichiara che è generato e indica dove fare le modifiche;
8. scrive `.claude/settings.json` con i permessi del progetto (**Implementato in 0.30.0**; l'elenco è in [Installazione e requisiti](Installazione%20e%20requisiti.md), sezione 3.5). Le regole dell'utente vanno in `.claude/settings.local.json`, che il generatore non tocca;
9. registra in `.campaign/version.yaml` un'impronta del file generato, così il validatore rileva le modifiche fatte a mano.

**Superata dalla Riprogettazione (decisione 11, 2026-11-11).** Non esistono più la variante per Codex del template e le istruzioni di ripiego per Codex: il template è uno solo. Per il file `AGENTS.md`, vedi le questioni aperte.

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
- il formato di `campaign.seed`: nome di un file `.md` relativo alla radice, senza `..` (il file può non esistere ancora);
- le chiavi ammesse: una chiave sconosciuta è un errore. `allow_model_imagination` è ammessa con qualunque valore e ignorata;
- l'unicità degli `id` di categoria e l'esistenza delle cartelle dichiarate in `structure` (solo quelle: il validatore non controlla altro);
- l'esistenza dell'adattatore e dei profili di stile citati;
- la coerenza delle carte: `cards: true` ha senso solo su una categoria di tipo `oggetti`;
- la compatibilità fra la versione del framework in `.campaign/version.yaml` e la versione installata;
- l'impronta dei file generati in `.campaign/version.yaml`, per rilevare modifiche a mano.

Il validatore viene eseguito all'avvio, dopo ogni modifica alla configurazione e prima di ogni generazione. Il suo output è in linguaggio semplice («La cartella Creature non esiste: la creo o la indichi?»), non in messaggi di errore grezzi. I casi di prova (file valido, campo mancante, enumerativo errato, cartella inesistente, profilo sconosciuto, chiave sconosciuta, seme con un percorso non valido) fanno parte della verifica descritta in [Robustezza e test](Robustezza%20e%20test.md).

## Questioni aperte

- **Nomi dei file in `.campaign/instructions/`.** Va deciso se usare un nome unico per tutti gli agenti o uno per ciascuno.
- **Enumerativi chiusi o aperti.** Per `prose.register` e `structure[].type` la proposta è un elenco chiuso; resta da decidere chi può aggiungere valori e come.
- **Gerarchia dei luoghi.** La configurazione dichiara solo le categorie. Non è deciso se anche la gerarchia di `Mondo` (continente, regione, luogo) debba essere descritta nel file o ricavata dalle cartelle.
- **Lingue secondarie.** Non è deciso se una campagna possa avere enciclopedia o schede in più lingue e come si collegano.
- **Wrapper per Claude e Codex.** **Deciso (2026-11-07)** per il file `CLAUDE.md`: nella radice della campagna il generatore scrive un `CLAUDE.md` breve, che rimanda soltanto a `.campaign/instructions/`, l'unica fonte, e a `.campaign/customizations.md`. **Superata dalla Riprogettazione (decisione 11, 2026-11-11)** per la parte Codex: Codex non è più un plugin del framework, quindi non c'è più un wrapper da scrivere per Codex (il file `AGENTS.md` è trattato sotto).
- **AGENTS.md (aggiunta con questa riscrittura, 2026-11-11).** **Deciso (2026-11-11):** AGENTS.md non si genera più; la migrazione world-graph-v1 lo toglie se è quello scritto dal framework, e lo lascia se il master lo ha modificato.
- **Fonti esterne e audit.** **Deciso (2026-11-09):** l'audit di continuità e la ricerca nel canone leggono i documenti delle fonti `external` come canone in sola lettura (vedi «Fonti esterne»): contano per il confronto, una contraddizione con un documento della campagna è un errore reale, non vengono mai modificati e l'audit non propone mai di cambiarli. Il linker non cambia: non cerca menzioni al loro interno.
- **Regole di processo fisse.** L'elenco delle regole che il template impone, e che la configurazione non può disattivare, va confrontato con [Processi di core](Processi%20di%20core.md) prima di essere fissato.
