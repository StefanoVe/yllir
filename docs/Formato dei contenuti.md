# Formato dei contenuti

**Stato:** Bozza di progetto
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

Questo documento definisce la forma dei file che il framework produce e legge: le regole comuni a ogni documento, le convenzioni dei testi di trama, la forma della cronaca, un modello per ogni tipo di scheda, e la divisione fra ciò che controlla uno script e ciò che resta al giudizio dell'agente. Il controllo meccanico è descritto qui in termini di regole; i casi di prova che lo verificano stanno in [Robustezza e test](Robustezza%20e%20test.md).

**Deciso, 2026-11-11.** Aggiornato alla [Riprogettazione](Riprogettazione.md): dove questo documento e la riprogettazione divergono, vale la riprogettazione.

Convenzione dei marcatori: **Deciso** indica ciò che è fissato dall'indice; tutto il resto è **Proposta** da approvare. Gli esempi sono fittizi. Chiude il documento la sezione [Questioni aperte](#7-questioni-aperte).

## 1. Regole comuni a ogni documento

### 1.1 Titolo

**Proposta.** Ogni scheda ha un solo titolo di primo livello (`#`), che è il nome del soggetto. Le sezioni sono di secondo livello (`##`), le sottosezioni di terzo (`###`). Le sessioni fanno eccezione (vedi sezione 2).

Il titolo è l'unico posto in cui il nome compare come dato: il nome del file lo segue (vedi 1.5), e le uscite lo leggono da lì.

### 1.2 Metadati in testa

**Deciso, 2026-11-11.** Il blocco dei metadati è un blocco YAML dentro un commento HTML, ed è il primo contenuto del file, prima del titolo. Il commento è nascosto da ogni anteprima Markdown, quindi il blocco resta nel documento senza comparire come tabella. Regole:

- la prima riga del file è esattamente `<!-- yllir`;
- il blocco si chiude alla prima riga esattamente `-->`;
- dentro valgono le stesse chiavi e la stessa sintassi di prima;
- nessuna riga interna può contenere `-->`.

Il framework scrive solo questa forma. Legge ancora la vecchia forma fra due righe `---`; il motore converte un blocco `---` quando salva, e la migrazione `metadata-comment-v1` converte i documenti delle campagne esistenti (vedi [Aggiornamenti e migrazioni](Aggiornamenti%20e%20migrazioni.md)).

```yaml
<!-- yllir
id: porto-di-selce
location: [costa-di-selce]
-->
```

Sono ammessi solo i campi della tabella. Ogni altro campo è un errore: un campo nuovo si aggiunge solo quando una campagna reale lo richiede.

| Campo | Obbligatorio per | Forma | Significato |
| --- | --- | --- | --- |
| `id` | ogni documento della campagna | slug unico in tutta la campagna | identità stabile: route, codici QR, collegamenti |
| `location` | soggetti con una posizione: personaggi, creature, oggetti, annunci | lista di `id` di luoghi; `[]` se non ha un luogo fisso | luogo attuale del soggetto; una creatura che vive in più luoghi li elenca tutti |
| `played` | pagine di cronaca (**Deciso**, 2026-11-07) | lista di `id` delle sessioni o attività giocate quella sera; `[]` se nessuna | unica fonte per sapere che cosa è stato giocato: la preparazione verifica i prerequisiti da qui; lo scrive il processo «dopo la sessione» |
| `depends_on` | sessioni e attività di trama | lista di `id` di sessioni o attività; `[]` se non ne ha | prerequisiti (vedi sezione 2) |
| `characters` | facoltativo, nei file evento di trama | lista di `id` di schede di personaggio; `[]` o assente se l'evento non nomina personaggi | i personaggi che l'evento nomina e fa agire o parlare; **Proposta** |
| `items` | facoltativo, nei file evento di trama (**Deciso, 2026-11-10**) | lista senza duplicati di `id` di schede oggetto; `[]` o assente se l'evento non nomina oggetti rilevanti | gli ID sono validati meccanicamente; oggetti con scheda coinvolti nell'evento; i candidati nel testo omessi dal campo richiedono giudizio dell'agente |
| `appearances` | facoltativo, nei file evento di trama (**Deciso, 2026-11-10**) | lista di `{subject: ID, location: [PLACE_IDS]}` | presenza esplicita di un soggetto nella scena e nei luoghi dichiarati; non si deduce da `characters`, `items` o menzioni |
| `print` | oggetti con carta | `to-print`, `printed` o `reprint` | stato fisico della carta; è l'unico posto in cui sta |
| `template` | categorie con più modelli: Personaggi (`npc`, `vendor`), Creature (`enemy`, `creature`), Oggetti (`item`, `notice`) | uno dei valori indicati | modello della scheda, da cui il validatore ricava le sezioni obbligatorie |
| `aliases` | facoltativo, per ogni scheda | lista di nomi alternativi | forme alternative del nome; fonte unica per l'indice dei soggetti |
| `merged_ids` | solo dopo un'unione di schede (vedi [Skill di libreria](Skill%20di%20libreria.md#l19-manutenzione-della-continuità)) | lista di `id` | identità assorbite: route e QR già stampati restano validi |
| `kind` | ogni documento delle categorie `places`, `subjects`, `objects`; nelle categorie `free` solo per gli eventi (`kind: event`), perché un concetto della storia non ha `kind` | uno fra `place`, `character`, `creature`, `item`, `faction`, `event` | **Deciso, 2026-11-11.** Il tipo del soggetto, usato dagli script del grafo. Un `kind: place` sta solo nella categoria dei luoghi. |
| `provenance` | ogni documento delle categorie `places`, `subjects`, `objects`, `free`, `plot`, `chronicle` | `master` (detto dal master), `played` (giocato al tavolo) o `generated` (generato dal framework) | **Deciso, 2026-11-11.** La provenienza dell'intero documento (decisione 12 della riprogettazione). Quando il master modifica a mano un documento `generated`, il motore lo salva come modifica manuale e lo segna `master`. |
| `sketch` | facoltativo | solo il valore `true` | **Deciso, 2026-11-11.** Segna un abbozzo (vedi 4.12). |
| `status` | facoltativo | `alive`, `dead`, `missing`, `active`, `destroyed` o `unknown` | **Deciso, 2026-11-11.** Stato del soggetto nella cronologia. |
| `ended` | facoltativo, solo con `status: dead` o `destroyed` | un numero, come `when` | **Deciso, 2026-11-11.** Posizione nella cronologia in cui il soggetto è morto o è stato distrutto. |
| `when` | obbligatorio per `kind: event`, vietato per gli altri | un numero intero o decimale, anche negativo | **Deciso, 2026-11-11.** La posizione dell'evento sulla cronologia del mondo. La convenzione del calendario (per esempio «anno 312 dell'Ascia» diventa `312`) sta nel seme del mondo. |
| `participants` | facoltativo, solo per `kind: event` | lista di `id` dei soggetti | **Deciso, 2026-11-11.** I soggetti che prendono parte all'evento. |
| `relations` | facoltativo | lista in blocco di voci con `to` (un `id`) e `type` | **Deciso, 2026-11-11.** `type` è fra `member-of` (appartenenza), `kin-of` (parentela), `ally-of` (alleanza), `rival-of` (rivalità) e `depends-on` (dipendenza: debito, servizio, bisogno). |

**Deciso, 2026-11-11.** Esempio per `relations`, fittizio:

```yaml
relations:
  - to: gilda-del-sale
    type: depends-on
  - to: borgo-cenere
    type: member-of
```

**Chi li scrive.** Solo il framework, nei propri processi. Il master non li modifica a mano; se li apre, li trova leggibili. Il validatore li legge e li verifica, e le risposte al master non li mostrano.

**Regole di forma.**

- Le chiavi sono in minuscolo, con il trattino basso dove serve. Le liste sono in forma `[a, b]`.
- Un `id` è uno slug: solo minuscole, cifre e trattini. Si assegna alla creazione e non cambia mai, neppure quando il titolo cambia.
- I riferimenti (`location`, `depends_on`, `characters`) puntano sempre a `id`, mai a nomi di file o a link. Così una rinomina non rompe nulla.
- `appearances[].subject` e `appearances[].location` puntano sempre agli `id` delle schede del soggetto e dei luoghi.
- Il nome del soggetto e la categoria non si ripetono nei metadati. Il tipo si dichiara con `kind`, perché gli script del grafo ne hanno bisogno.
- I metadati non contengono nulla di riservato: sono dati di sistema, non contenuto.

**Deciso, 2026-11-11. Controlli del grafo.** Il motore controlla, senza alcun modello, i riferimenti a soggetti inesistenti; un `location` che non è un luogo; un evento con un partecipante o con un luogo che cade dopo il `ended` di quel partecipante o di quel luogo; lo stesso partecipante in due luoghi diversi in due eventi con lo stesso `when`. L'indice derivato è `.campaign/cache/world.json`: lo rigenera il motore e non si modifica a mano.

### 1.3 Parte pubblica e blocco riservato

**Proposta.** Tutto ciò che sta sopra il blocco riservato è pubblico. Il blocco riservato è l'ultimo contenuto del file e ha questa forma esatta:

```markdown
<!-- master -->
## Master

### Indicazioni per il master

Testo riservato al master.
<!-- /master -->
```

Regole:

- Un file ha al massimo un blocco riservato. Il marcatore di apertura e quello di chiusura stanno ciascuno su una riga propria, senza altro testo.
- La prima riga del blocco è il titolo `## Master`. Sotto di esso compaiono solo titoli di livello `###` o inferiore.
- Dopo `<!-- /master -->` non c'è altro contenuto.
- Le uscite (enciclopedia, carte, fogli di stampa, mappe) leggono solo la parte pubblica. Un soggetto interamente riservato non esce affatto, titolo compreso.
- Un rimando da un testo pubblico a una nota riservata punta alla nota con l'ancora `#master`, per esempio `Ilde Varno.md#master`, e non ne riporta il contenuto.
- Il passaggio di un contenuto da riservato a pubblico avviene solo per azione esplicita del master: il testo si sposta fuori dal blocco.
- Le categorie di tipo `master-only` (vedi 4.8) non usano il blocco: l'intero file è riservato.
- **Chi lo legge.** Gli agenti che lavorano sul canone (esecutori, audit di continuità, dottore della campagna, manutenzione della continuità, portineria e handoff) vedono anche il blocco riservato, perché devono controllarlo. Non lo ricevono mai i revisori di testi destinati ai giocatori (enciclopedia, carte, riepiloghi), i fornitori di immagini, le ricerche web e i servizi di pubblicazione.

**Deciso, 2026-11-11.** Un'invenzione non si presenta mai come citazione di una fonte, e un segreto inventato sta solo nel blocco riservato.

### 1.4 Immagini sotto il titolo

**Proposta.** Un'immagine principale può seguire il titolo, prima della prima sezione:

```markdown
![Lanterna di ottone con vetro annerito](img/lanterna-da-bordo.png)
```

- Il testo alternativo descrive l'immagine e non ripete il nome del file.
- L'immagine sta nella cartella `img/` della categoria o del luogo cui appartiene la scheda, e si richiama con un link relativo.
- Il nome del file immagine è in minuscolo, con trattini al posto degli spazi.
- Una carta (oggetto con `print`) ha accanto un sorgente a livelli con lo stesso nome base, in formato `.psd`. La coppia sta nella stessa `img/`.
- Un'immagine richiamata deve esistere; il validatore lo verifica.

### 1.5 Nomi dei file

**Proposta.**

- Il nome del file è il titolo del documento, senza `#`. Sono ammessi spazi, apostrofi e lettere accentate. Non sono ammessi i caratteri `/ \ : * ? " < > |`.
- Nella stessa cartella non esistono due file con lo stesso nome, anche se differiscono solo per maiuscole o minuscole.
- Il nome segue il titolo. Rinominare un soggetto significa rinominare il file con uno script, che aggiorna i link relativi; l'`id` resta lo stesso.
- Una cartella di luogo che ha sotto-luoghi contiene la scheda omonima: `Mondo/Costa di Selce/Costa di Selce.md`.
- Un file di cronaca si chiama con la data: `AAAA-MM-GG.md`.

### 1.6 Link relativi

**Deciso** nella forma generale (Markdown semplice e link relativi standard, dall'indice). **Proposta** per il dettaglio.

- Si usano solo link Markdown relativi, per esempio `[Architettura](Architettura.md)`. Gli spazi si codificano come `%20`.
- Un link punta solo a file esistenti dentro la campagna. Non si usano percorsi assoluti né file fuori dalla campagna.
- L'ancora a una sezione è lo slug del titolo in minuscolo, con trattini: `scheda.md#indicazioni-per-il-master`.
- Un testo di canone non linka mai le uscite (cartelle derivate, vedi sezione 3 dell'[Architettura](Architettura.md)).
- Ogni menzione di un soggetto che ha una scheda diventa un link alla scheda, non solo la prima. È il compito della funzione di collegamenti (L3 in [Skill di libreria](Skill%20di%20libreria.md#l3-collegamenti)), che esclude titoli, corsivi narrativi e blocchi di codice.

### 1.7 Corsivo narrativo

**Proposta.** Il testo che il master legge ad alta voce, o che descrive ciò che i personaggi percepiscono, è in corsivo, un paragrafo per volta:

```markdown
_La nebbia sale dal molo prima dell'alba e si impiglia nelle reti stese._
```

- Il corsivo marca la funzione del testo (narrazione), non l'enfasi.
- Il corsivo si usa nelle sessioni e nelle parti pubbliche delle schede che descrivono luoghi, soggetti e oggetti.
- Il testo integrale di un oggetto o di un annuncio non è narrazione: è prosa normale, senza corsivo e senza `>`.
- I collegamenti escludono i corsivi narrativi.

### 1.8 Note del master

**Proposta.** Una nota personale del master sta nel blocco riservato (1.3). Fa eccezione `Trama/`: i suoi documenti sono per il master, e in essi le note in blocchi con tre backtick sono ammesse. In ogni altra scheda i blocchi con tre backtick sono ammessi solo dentro il blocco riservato: fuori da esso il validatore li segnala, perché lascerebbero una nota nella parte che le uscite leggono.

### 1.9 Registro e lingua

**Proposta.**

- Il registro della prosa (`elevated`, `plain`, `colloquial` o `mixed`) viene da `prose.register` della configurazione (vedi [Configurazione](Configurazione.md)). Vale per le descrizioni narrative: corsivi, descrizioni dei luoghi, dei soggetti e degli oggetti.
- Le sezioni tecniche (statistiche, prezzi, metadati, tabelle, esiti delle prove) sono neutre e non cambiano con il registro.
- I testi della campagna sono nella lingua di `language.main`. I titoli delle sezioni dei modelli (`## Descrizione`, `## Effetti` e le altre) sono contenuto della campagna e si traducono dalla lingua configurata; i nomi dei metadati e dei tipi restano in inglese, come nel resto del framework.

### 1.10 Struttura geografica canonica

**Deciso (2026-11-10).** L'archivio canonico è organizzato prima per categoria e poi per geografia. Il documento canonico di un soggetto è collocato sotto la propria categoria al comune antenato della sua location corrente e di tutte le location indicate nelle sue `appearances` esplicite. Se non è nota alcuna location, il documento si trova nella cartella localizzata `Da collocare` della categoria. Per i luoghi, il file del luogo che contiene sotto-luoghi ha la forma `<Luogo>/<Luogo>.md`; un luogo foglia usa il proprio nome file sotto al luogo contenitore. Per esempio, `Mondo/Costa di Selce/Costa di Selce.md` definisce la costa, mentre `Mondo/Costa di Selce/Porto.md` definisce il porto foglia.

I file degli eventi restano nelle cartelle delle sessioni e sono le fonti originali. Le viste geografiche degli eventi sono collegamenti simbolici rigenerabili: non si creano copie del testo, e restano nella cartella di trama, dentro una cartella localizzata (`Per luogo` / `By location`), mentre la cartella dei soggetti senza luogo è `Da collocare` / `Unplaced`. I percorsi geografici sono derivati e il piano completo di spostamenti, collegamenti, rimozioni e riscritture viene rivisto indipendentemente prima dell'applicazione. Il linker e i controlli successivi lavorano sui percorsi canonici.

## 2. Testi di trama (sessioni e attività)

I testi di trama stanno nella categoria `Trama/`, con una cartella per sessione o per attività. Le attività minori seguono la stessa forma e si distinguono solo per il titolo.

**Proposta (2026-11-09, scelta dell'autore).** Ogni sessione ha un file principale e un file dedicato per ogni evento principale:

```text
Trama/
  <Sessione>/
    <Sessione>.md          file principale: mappa concettuale degli eventi (derivato)
    Eventi/
      <Evento 1>.md        un file per evento principale
      <Evento 2>.md
```

- Un evento principale è ciò che prima era un titolo `#`. Gli eventi minori (`##`) e le prove (`###`) restano dentro il file del loro evento e non hanno file propri.
- Il file principale è un **derivato**: lo genera uno script dai metadati degli eventi (vedi 2.8) e non si modifica a mano. Contiene la mappa concettuale (grafo Mermaid) e l'elenco degli eventi, ciascuno con un link al suo file.
- Gli eventi non sono ripetuti nel file principale: vi compaiono solo come nodi e link. Un'informazione ha un solo posto (principio 16 di [Principi](Principi.md)).

### 2.1 Metadati

**Proposta.**

- `id` e `depends_on` sono obbligatori, sia nel file principale della sessione sia in ogni file evento. Chi non ha prerequisiti dichiara `depends_on: []`, così il vuoto è esplicito e non è una dimenticanza.
- Nel file principale, `depends_on` elenca gli `id` delle sessioni o attività che devono essere giocate prima. In un file evento elenca gli `id` degli eventi (della stessa sessione o di altre) che devono accadere prima. Non conta l'ordine dei file: solo il campo crea una dipendenza.
- Un file evento dichiara anche `session`, l'`id` della sua sessione, perché ogni evento appartiene a una sola sessione.
- `location` è facoltativo e indica il luogo principale della scena o dell'evento.
- `characters` (**Proposta**, 2026-11-09) è facoltativo nei file evento di trama: elenca gli `id` dei personaggi che l'evento nomina e fa agire o parlare, ciascuno con la sua scheda (vedi 2.6). Un evento che non nomina personaggi dichiara `[]` oppure non scrive il campo. Ogni `id` deve essere una scheda di personaggio (`npc`, `vendor`, `enemy` o `creature`).
- `appearances` (**Deciso**, 2026-11-10) è facoltativo nei file evento: elenca solo le presenze geografiche esplicitamente stabilite dal testo della scena, nella forma `- subject: ID` / `location: [PLACE_IDS]`. Non si inferisce la presenza da `characters`, `items`, link, nomi o menzioni. Ogni soggetto e luogo deve avere una scheda.
- `enemies` (**Deciso (2026-11-14)**) è facoltativo nei file evento e dichiara uno scontro. È una lista di voci, ciascuna con due chiavi: `id`, che deve essere una scheda di nemico, creatura, PNG o venditore (`template` `enemy`, `creature`, `npc` o `vendor`), e `count`, un numero intero positivo. Lo stesso `id` compare una sola volta. Un evento senza scontro non scrive il campo. Il bilanciamento degli incontri legge questo campo (vedi [Skill di libreria](Skill%20di%20libreria.md#l15-bilanciamento-degli-incontri)).

```yaml
<!-- yllir
id: il-faro-spento-02
depends_on: [il-faro-spento-01]
location: [porto-di-selce]
-->
```

Un file evento (`Trama/Il faro spento 2/Eventi/Arrivo al porto.md`), con i suoi dati fittizi:

```yaml
<!-- yllir
id: il-faro-spento-02-arrivo
session: il-faro-spento-02
depends_on: []
location: [porto-di-selce]
-->
```

Un evento che fa agire o parlare dei personaggi li elenca in `characters` (esempio fittizio):

```yaml
<!-- yllir
id: il-faro-spento-02-consegna
session: il-faro-spento-02
depends_on: [il-faro-spento-02-arrivo]
location: [porto-di-selce]
characters: [ilde-varno, bruno-tesi]
appearances:
  - subject: ilde-varno
    location: [porto-di-selce]
-->
```

Un evento con uno scontro dichiara i nemici in `enemies` (esempio fittizio):

```yaml
<!-- yllir
id: il-faro-spento-02-ponte
session: il-faro-spento-02
depends_on: [il-faro-spento-02-arrivo]
location: [porto-di-selce]
characters: [ilde-varno]
enemies:
  - id: guardiano-di-sale
    count: 3
  - id: capo-dei-predoni
    count: 1
-->
```

### 2.2 Gerarchia dei titoli

**Proposta.** Nei testi di trama i livelli dei titoli indicano il tipo di passaggio:

| Livello | Forma | Uso |
| --- | --- | --- |
| (nome del file) | `Eventi/<Evento>.md` | evento principale: una scena, un incontro, un passaggio significativo. Era il titolo `#` |
| `##` | `## Titolo` | azione o evento minore dentro l'evento: esplorazione, interazioni, passaggi secondari |
| `###` | `### Titolo` | prova o azione circoscritta: un singolo tentativo con il suo esito |

Un file evento non ha un titolo di documento separato: il nome del file è il titolo dell'evento e il testo comincia subito. I titoli `##` e `###` sono quelli del file. Il nome del file principale è il titolo della sessione.

### 2.3 Prove ed esiti

**Decisione dell'autore (2026-11-11).** Ogni prova che i giocatori tirano è una sezione propria del file evento, non una frase che la chiede. Il titolo `### Prova: <valore>` riporta la prova: il valore sta nel formato dell'adattatore di sistema (vedi [Sistemi di gioco e stili](Sistemi%20di%20gioco%20e%20stili.md)) oppure, senza adattatore, a parole, con la difficoltà a parole. Sotto il titolo, una riga facoltativa dice chi tira o quando. Seguono `#### Successo` e `#### Fallimento`, ciascuno con un paragrafo che dice che cosa accade e che cosa il gruppo sa o ottiene: mai una parola sola, mai «riesce» o «fallisce». Una prova non si chiede mai in prosa. Il motore lo controlla al salvataggio. Le schede nel vecchio formato a lista (`- **Successo:**`) si convertono con la migrazione `scene-checks-v1`.

Esempio, con dati fittizi:

```markdown
### Prova: Carisma (Persuasione) CD 13

Chi parla con Sibilla tira.

#### Successo

Il gruppo ottiene un consiglio sulla strada per il bosco.

#### Fallimento

Il gruppo riceve soltanto un invito a tornare il giorno dopo.
```

Il core non fissa né i valori né gli effetti delle prove: li fornisce l'adattatore. Senza adattatore il campo della difficoltà resta testo libero da definire.

### 2.4 Interventi meta del master

**Proposta.** Un intervento rivolto direttamente ai giocatori, per chiarire una possibilità o comunicare un'informazione a uno o più giocatori, si scrive come citazione:

```markdown
> Potete percorrere la costa in qualunque direzione, ma senza una barca il porto resta l'unico punto d'appoggio.
```

Gli interventi meta non sono narrazione e non definiscono l'identità di nulla.

### 2.5 Narrazione e note

**Proposta.** La narrazione da leggere è in corsivo (1.7). Le note personali del master seguono la regola di 1.8.

### 2.6 Identità e rimandi

**Proposta.** Una sessione non definisce l'identità di un personaggio, di un luogo o di un concetto: descrive ciò che accade e rimanda alla scheda dedicata. Il rimando è un link Markdown relativo alla scheda: il testo del link è il nome del soggetto, e il percorso parte dalla cartella del file in cui si scrive.

**Proposta (2026-11-09).** La scheda di un personaggio è la fonte di verità per la sua identità (chi è: nome, ruolo, aspetto, modi, voce, che cosa vuole, segreti), ma non per le sue azioni durante la trama: le azioni stanno nei documenti di trama e, una volta giocate, nella cronaca. Ogni volta che un personaggio viene definito in un documento di trama, serve la sua scheda (vedi 4.2). Identità: vince la scheda. Azioni nella trama: vince la trama. Se una scena fa agire un personaggio contro la sua scheda, non è un errore da correggere in silenzio: è una domanda per il master.

### 2.7 Conclusione

**Proposta.** Un evento può chiudersi con una sezione in prosa che descrive dove porta la scena. Questa sezione non è una fonte di dati: le dipendenze della mappa della trama vengono solo dal campo `depends_on`, mai dal testo.

### 2.8 File principale della sessione (derivato, rivisto)

**Proposta.**

- Lo script rigenera il file principale dai file evento della cartella `Eventi/`: grafo Mermaid con un nodo per evento e un arco per ogni `depends_on`, elenco degli eventi con link relativo al loro file, eventi senza prerequisiti (ingressi) ed eventi che nessuno richiede (uscite). Gli archi sono le dipendenze fra eventi, collegate dall'agente secondo 2.9: lo script non le ricava dal testo.
- Il file ha il campo `generated: true` nei metadati e una riga iniziale che dice di non modificarlo.
- **Rivisto e corretto.** Dopo la rigenerazione un sub-agente indipendente rilegge la mappa rispetto agli eventi. Le correzioni si applicano alle **fonti** (metadati o testo degli eventi), mai alla mappa, che altrimenti perderebbe la correzione alla rigenerazione successiva. Poi la mappa si rigenera di nuovo.
- Lo script segnala eventi con `session` diversa dalla cartella, `id` duplicati, riferimenti inesistenti e cicli.

### 2.9 Collegamento degli eventi

**Proposta (2026-11-09, scelta dell'autore).** Gli eventi di una sessione devono essere collegati fra loro con `depends_on`, anche quando si biforcano e si ricongiungono. Altrimenti la mappa concettuale della sessione mostra solo una fila di eventi scollegati. Il collegamento è un giudizio, non un calcolo: lo fa un agente che esamina i testi degli eventi, mentre la mappa resta un derivato (2.8).

Il collegamento avviene in due momenti:

- (a) dopo la migrazione delle campagne esistenti, che crea gli eventi con `depends_on: []` (vedi [Aggiornamenti e migrazioni](Aggiornamenti%20e%20migrazioni.md));
- (b) ogni volta che si creano nuovi eventi di una sessione.

Lo script deterministico si limita a segnalare le sessioni i cui eventi non sono collegati: una sessione con due o più eventi e nessuna dipendenza fra di essi. Non decide nulla.

Regole per l'agente:

- una scelta o una biforcazione fa dipendere più eventi dalla stessa scena: sono i rami;
- un evento raggiungibile da più rami dipende da tutti questi rami: è un rientro nel filone principale;
- i primi eventi hanno `depends_on: []`;
- l'adiacenza nell'elenco non è una dipendenza: se il testo non dice nulla, l'agente usa l'ordine dell'elenco e lascia una nota;
- l'agente non crea, non rinomina, non unisce e non cancella eventi;
- non sono ammessi cicli;
- l'agente scrive solo il campo `depends_on` dei file evento, attraverso la sequenza di scrittura (revisione indipendente, versione salvata).

## 3. Pagina di cronaca

**Proposta.** La cronaca racconta ciò che è accaduto al tavolo, ed è scritta dal processo «dopo la sessione» a partire dal registro di sessione (L18 in [Skill di libreria](Skill%20di%20libreria.md#l18-registro-di-sessione)). Sta nella categoria `Cronaca/`, con un file per serata chiamato con la data.

```markdown
<!-- yllir
id: cronaca-2026-11-14
played: [il-faro-spento-01]
-->

# Il faro si spegne

## Accaduto

Il gruppo scende al porto all'alba e trova la lanterna spenta. Ilde Varno non risponde alla porta.

## Fili aperti

- Il registro del faro è sparito.
```

La forma minima è: metadati con `id` e `played`, titolo `#`, una sezione `## Accaduto` in prosa al passato, e facoltativamente `## Fili aperti` come lista. Un blocco riservato è facoltativo. La cronaca non riscrive l'identità di nulla e non anticipa ciò che non è ancora accaduto.

## 4. Modelli per tipo

Ogni modello indica la categoria, i metadati, le sezioni obbligatorie e facoltative nell'ordine in cui compaiono, il blocco riservato e un esempio breve. Il tipo di una categoria è il campo `type` della sua voce in `structure` (vedi [Configurazione](Configurazione.md)): `plot`, `chronicle`, `places`, `subjects`, `objects`, `free` o `master-only`.

### 4.1 Luogo

**Categoria:** cartella a cascata in `Mondo/`, tipo `places`.
**Metadati:** `id`.
**Obbligatorie, in ordine:** titolo; `## Descrizione`, che si apre con un paragrafo in corsivo.
**Facoltative, in ordine:** immagine sotto il titolo; `## Abitanti` e `## Punti d'interesse`, dopo `## Descrizione`; `## Da definire` (obbligatoria se restano lacune).
**Blocco riservato:** `### Indicazioni per il master`, seguito da `### Agganci`. Gli spunti non canonici non stanno nella scheda: stanno in `Appunti/`.
**Deciso, 2026-11-11.** `## Abitanti`, `## Punti d'interesse` e `### Agganci` sono facoltativi: le schede esistenti restano valide.

Un luogo con sotto-luoghi è una cartella con la scheda omonima dentro. L'elenco dei sotto-luoghi non si scrive a mano: si ricava dalla posizione delle cartelle, come indice derivato.

```markdown
<!-- yllir
id: costa-di-selce
-->

# Costa di Selce

_Una striscia di scogli e moli fra la montagna e il mare, dove le barche rientrano sempre con il vento di ponente._

## Descrizione

La costa collega i villaggi di pesca al porto principale. Le strade sono poche e spesso chiuse dalle mareggiate.

<!-- master -->
## Master

### Indicazioni per il master

Una boa segna un passaggio che sulle carte non esiste: lo conoscono solo i pescatori più anziani.
<!-- /master -->
```

### 4.2 Personaggio non giocante (PNG)

**Categoria:** `Personaggi/`, tipo `subjects`.
**Metadati:** `id`; `template: npc`; `location` come lista dei luoghi in cui si trova di norma.
**Obbligatorie, in ordine:** titolo; `## Ruolo`; `## Aspetto e modi`; `## Al tavolo`, con voce, modo di parlare e che cosa vuole.
**Facoltative, in ordine:** immagine sotto il titolo (ritratto); `## Statistiche`, obbligatoria se il PNG può combattere; `## Assortimento`, per i venditori (4.4); `## Da definire`. Quando presente, `## Statistiche` usa le tabelle localizzate descritte in 4.3. Può comparire anche nella scheda di un venditore, se pertinente.
**Blocco riservato:** `### Indicazioni per il master`; dopo di essa, tutti facoltativi, `### Motivazioni`, `### Segreti` e `### Agganci`. **Deciso, 2026-11-11.** I legami si dichiarano in `relations` (vedi 1.2); la prosa di `## Ruolo` può descriverli.

Un PNG che svolge più ruoli usa il modello più ricco e dichiara le sezioni facoltative che usa. Non si crea una scheda per ciascun ruolo (L14 in [Skill di libreria](Skill%20di%20libreria.md#l14-gestione-dei-png)).

```markdown
<!-- yllir
id: ilde-varno
template: npc
location: [porto-di-selce]
-->

# Ilde Varno

## Ruolo

Custode del faro, l'unico che conosce il funzionamento della lanterna.

## Aspetto e modi

_Una donna minuta, con il cappotto cerato sempre allacciato, che guarda il mare prima di guardare chi le parla._

## Al tavolo

Parla poco, risponde con domande e chiede sempre chi ha acceso la lanterna.

<!-- master -->
## Master

### Indicazioni per il master

Sa dove è finito il registro del faro, ma non lo dirà a chi non ha ancora trovato la chiave.
<!-- /master -->
```

Un PNG nominato da un documento di trama ha la sua scheda prima del primo evento che lo definisce, o insieme ad esso: vedi 2.6.

### 4.3 Nemico (creatura)

**Categoria:** `Creature/`, tipo `subjects`.
**Metadati:** `id`; `template`: `enemy` per una creatura che combatte, `creature` per una che non combatte (animali, cavalcature); `location`, obbligatorio: la lista di tutti i luoghi in cui vive, `[]` se è errante.
**Obbligatorie, in ordine:** titolo; `## Natura`, lore pubblica su ciò che la creatura è e su ciò che i personaggi possono sapere di lei; `## Statistiche`, con le tabelle localizzate fornite dall'adattatore. Se la creatura non combatte (`template: creature`), la sezione dichiara «Nessuna statistica: non combatte» al posto delle tabelle.
**Facoltative, in ordine:** immagine sotto il titolo; `## Bottino`, con il valore ricavato dal documento di economia; `## Da definire`.
**Blocco riservato:** `### Indicazioni per il master`, con condotta, tattica, quando fugge e segreti.

Il modello separa tre cose in tre posti: la lore sta nella parte pubblica (`## Natura`), le regole nella parte pubblica (`## Statistiche`, con il formato dell'adattatore), le indicazioni per il master solo nel blocco riservato. Un testo di condotta non sta mai fra le sezioni pubbliche. Le statistiche usano tabelle distinte per caratteristiche e valori, attacchi o capacità e dettagli, ed equipaggiamento e dettagli. Le intestazioni sono localizzate secondo la lingua della campagna.

```markdown
<!-- yllir
id: guardiano-di-sale
template: enemy
location: [costa-di-selce]
-->

# Guardiano di sale

## Natura

_Una creatura bassa e massiccia, coperta di cristalli di sale, che sorveglia le saline._

## Statistiche

### Caratteristiche

| Caratteristica | Valore |
| --- | --- |
| Minaccia | 2 |
| Parametro A | 14 |
| Parametro B | 30 |

### Attacchi e capacità

| Attacco o capacità | Dettagli |
| --- | --- |
| Colpo | Danno da taglio pari a un dado più un modificatore. |

### Equipaggiamento

| Oggetto | Dettagli |
| --- | --- |
| Scudo di legno | Riduce i danni da impatto. |

<!-- master -->
## Master

### Indicazioni per il master

Si ritira verso l'acqua quando scende sotto la metà dei punti struttura.
<!-- /master -->
```

Per una campagna in inglese, le intestazioni delle colonne sono `Characteristic` / `Value`, `Attack or ability` / `Details` e `Item` / `Details`. Gli esempi riportano valori fittizi; lo schema reale è quello dell'adattatore.

### 4.4 Venditore

**Categoria:** `Personaggi/`, come un PNG.
**Modello:** il modello del PNG (4.2), con `template: vendor` e in più le sezioni che seguono. Un venditore non ha un modello separato: la sezione `## Assortimento` e il valore `template: vendor` lo rendono tale.
**Obbligatorie aggiuntive:** `## Assortimento`, tabella con colonne `Oggetto`, `Prezzo`, `Nota`.
**Facoltative aggiuntive, in ordine:** `## Trattare`, con il modo di contrattare, in prosa pubblica; `## Deroghe`, obbligatoria se un prezzo esce dagli intervalli.
**Regole dei prezzi:** ogni prezzo è espresso in una valuta del documento di economia (vedi 4.9) e cade nell'intervallo del suo oggetto, moltiplicato per il fattore del luogo del venditore. Una deroga è sempre dichiarata con il motivo nella sezione `## Deroghe`.

**Forma del prezzo (Deciso (2026-11-14)):** `<numero> <valuta>`, con una delle forme della valuta (`2 scudi`, `0.5 scudo l'uno`); più importi si uniscono con `e` (`1 corona e 5 scudi`); il testo fra parentesi non si conta. Una cella senza cifre non è un prezzo numerico e non si controlla.

```markdown
## Assortimento

| Oggetto | Prezzo | Nota |
| --- | --- | --- |
| Corda di canapa | 2 scudi | prezzo di base |
| Lanterna da mare | 6 scudi | |
```

### 4.5 Oggetto (con carta)

**Deciso (2026-11-10):** la scheda dell'oggetto ha `## In breve`, `## Descrizione` e `## Effetti`, seguiti dalle sezioni facoltative `## Origine`, `## Ritrovamento`, `## Testo`, `## Valore`, in quest'ordine, e dal blocco riservato finale `### Indicazioni per il master`. La skill `item-manager` crea bozze e controlla le schede senza riscrivere quelle esistenti; le descrizioni delle schede già presenti si adattano una volta, dopo l'aggiornamento del framework, con la migrazione riprendibile descritta in [Gestione degli oggetti](Gestione%20degli%20oggetti.md).

**Categoria:** `Oggetti/`, tipo `objects`, con `template: item`. La categoria produce carte se la sua voce in `structure` dichiara `cards: true`.
**Metadati:** `id`; `template: item`; `location` (dove si trova adesso, come lista); `print`, solo per gli oggetti con carta.
**Obbligatorie, in ordine:** titolo; `## In breve`, sintesi pubblica; `## Descrizione`, ciò che i personaggi vedono o sanno; `## Effetti`, nel formato dell'adattatore, oppure «Nessun effetto di gioco». L'immagine di carta, se prevista, segue il titolo e precede le sezioni.
**Facoltative, in ordine:** `## Origine`, pubblica solo se i personaggi possono conoscerla; `## Ritrovamento`; `## Testo`, per il testo integrale di una lettera o di un libro (prosa normale, senza corsivo); `## Valore`, che segue il documento di economia.
**Blocco riservato:** `### Indicazioni per il master`, con l'origine vera e i segreti.

**Regole della carta.**

- La carta usa `## In breve`; per una scheda legacy senza questa sezione usa `## Descrizione` come ripiego, senza modificare la scheda.
- L'immagine finale è `img/<nome-base>.png`, con il sorgente `img/<nome-base>.psd` accanto.
- Il titolo stampato sulla carta è il titolo `#` della scheda. Quando il titolo cambia, la carta è marcata come da rigenerare: se era `printed`, passa a `reprint`.
- Una carta già stampata mantiene il nome del file: i codici QR puntano all'`id`, quindi non si rinomina per non rompere la stampa.

```markdown
<!-- yllir
id: lanterna-da-bordo
template: item
location: [porto-di-selce]
print: to-print
-->

# Lanterna da bordo

![Lanterna di ottone con vetro annerito](img/lanterna-da-bordo.png)

## In breve

Una lanterna di ottone con il vetro annerito dal fumo.

## Descrizione

Una lanterna di ottone con il vetro annerito dal fumo. La fiamma è ancora tiepida.

## Effetti

Nessun effetto di gioco.

<!-- master -->
## Master

### Indicazioni per il master

Non contiene segreti.
<!-- /master -->
```

### 4.6 Annuncio di bacheca

**Categoria:** `Oggetti/`: un annuncio è un oggetto (la carta appesa alla bacheca) con `template: notice`. Nessuna categoria in più (YAGNI).
**Metadati:** `id`; `template: notice`; `location`, con il solo luogo della bacheca; `print` se l'annuncio ha una carta.
**Obbligatorie, in ordine:** titolo; `## Testo`, il testo dell'annuncio come è affisso; `## Premio`, con la ricompensa nella forma dei prezzi (vedi 4.4), oppure «Nessun premio».
**Facoltative, in ordine:** immagine di carta sotto il titolo; `## Indizi`, ciò che il lettore può ricavare dall'annuncio.
**Blocco riservato:** `### Indicazioni per il master`, con il committente vero, le condizioni nascoste e l'esito reale.

```markdown
<!-- yllir
id: taglia-sul-falsario
template: notice
location: [porto-di-selce]
-->

# Taglia sul falsario

## Testo

Chi consegna alla Torre del porto il falsario che mette in circolo monete false riceve trenta scudi. Vivo, o con le prove della sua stampa.

## Premio

Trenta scudi, pagati alla Torre del porto.
```

### 4.7 Concetto di storia

**Categoria:** `Storia/`, tipo `free`. Vi stanno i concetti condivisi: fazioni, culti, eventi del passato, leggi, cosmologia.
**Metadati:** `id`.
**Obbligatorie, in ordine:** titolo; `## Definizione`, ciò che la campagna dichiara del concetto.
**Facoltative, in ordine:** `## Come appare`, dove e come i personaggi lo incontrano; `## Da definire`.
**Blocco riservato:** `### Indicazioni per il master`, con segreti e ganci.

Lo stato di un concetto (canone, spunto o bozza, come chiede il principio 8 di [Principi](Principi.md)) non ha un campo in questo modello: è in questioni aperte.

```markdown
<!-- yllir
id: patto-del-faro
-->

# Patto del faro

## Definizione

Accordo non scritto fra i custodi del faro e i pescatori: la luce resta accesa in cambio di un rimorchio gratuito nelle tempeste.

<!-- master -->
## Master

### Indicazioni per il master

Il patto è stato rotto da tre generazioni, ma nessuno lo ha ancora detto ad alta voce.
<!-- /master -->
```

### 4.8 Personaggio giocante

**Categoria:** file `Giocatori/<Nome>.md`, tipo `master-only`. È una scheda per personaggio, non una cartella. Gli originali (PDF, foto, testo) stanno in `Fonti/`.
**Metadati:** `id`; `level`, facoltativo: livello del personaggio (intero positivo), usato dal bilanciamento degli incontri. Classe e altre meccaniche restano in `## Scheda`.
**Obbligatorie, in ordine:** titolo; `## Scheda`, con i dati trascritti del personaggio nei campi dell'adattatore; `## Integrazione con la trama`, con i ganci nella forma che segue e i rimandi alle sessioni.
**Facoltative, in ordine:** `## Background`, come lo scrive il giocatore; `## Domande aperte`, da porre al giocatore; `## Originali`, con i link ai file in `Fonti/`.
**Blocco riservato:** non si usa. L'intero file è riservato, e nessuna scheda pubblica linka questa categoria.

**Forma di un gancio (Deciso (2026-11-14)).** Ogni gancio è una sottosezione `### <nome breve>` con quattro voci elenco, in quest'ordine: `- Gancio:`, `- Innesco:`, `- Posta:` e `- Stato: pronto` oppure `- Stato: da proporre`. Dopo le quattro voci un gancio può avere altre voci elenco, per esempio `- Sessioni: [...]`. Il controllo verifica che le quattro voci siano presenti e non vuote, e che lo stato sia uno dei due valori.

Un'integrazione che propone canone resta una proposta finché il master non la conferma. Il personaggio giocante non definisce l'identità di altri soggetti: quella sta nelle loro schede.

```markdown
<!-- yllir
id: pietro-sala
level: 3
-->

# Pietro Sala

## Scheda

Mestiere: pilota di chiatte. Forza di volontà alta, forza fisica media.

## Integrazione con la trama

### Il padre al faro

- Gancio: il padre di Pietro lavorava al faro, e conosce il custode.
- Innesco: Pietro passa dal faro durante la prima sessione.
- Posta: la verità sul padre cambia il destino di Pietro.
- Stato: pronto

### Debito con il Patto

- Gancio: un debito con il Patto del faro.
- Innesco: il Patto chiede il pagamento al porto.
- Posta: Pietro perde la chiatta o il nome.
- Stato: da proporre

## Domande aperte

- Il giocatore vuole che il padre sia ancora vivo?
```

### 4.9 Documento di economia

**File:** `Storia/Economia.md`, unico nella campagna, con percorso fisso. **Deciso (2026-11-14):** nasce quando il master risponde alla domanda sull'economia, all'intervista iniziale o nella migrazione `economy-v1`. Se risponde «più tardi», la domanda torna la prima volta che un documento ha bisogno di un prezzo, un salario o una ricompensa.
**Metadati:** `id: economia`.
**Obbligatorie, in ordine:** titolo; `## Valute`, tabella con colonne `Valuta`, `Equivalenza`, `Nota`; `## Prezzi base`, tabella con colonne `Categoria`, `Minimo`, `Massimo`, `Unità`; `## Salari`, tabella con colonne `Mestiere`, `Paga`, `Periodo`; `## Variazioni per luogo`, tabella con colonne `Luogo`, `Fattore`, `Motivo`, dove `Luogo` è un `id`.
**Facoltative, in ordine:** `## Deroghe in vigore`, con luogo, periodo e motivo di ogni deroga; `## Da definire`.
**Blocco riservato:** `### Indicazioni per il master`, con le cause che tengono i prezzi a quei livelli.

I numeri usano il punto come separatore decimale, così il controllo dei prezzi è sicuro.

**Forme delle valute (Deciso (2026-11-14)):**

- Più valute sono ammesse. Una riga per valuta. La cella della valuta può elencare più forme separate da ` / ` (`scudo / scudi`); la prima è il nome.
- La colonna `Equivalenza` dice `unità di conto` in una sola riga: è l'unità di riferimento del mondo. Ogni altra riga dice `<numero> <valuta>`: una unità di questa valuta vale quel numero di unità della valuta indicata. Sono ammesse catene (una valuta che vale un'altra valuta non di conto): il controllo le riporta all'unità di conto. Non sono ammessi cicli.
- `Minimo` e `Massimo` sono numeri semplici, nella valuta indicata dalla colonna `Unità`.
- `Fattore` è un numero positivo; moltiplica l'intervallo dei venditori del luogo.
- Le tabelle vuote, con solo intestazione e separatore, sono valide.
- Il cibo di riferimento della domanda iniziale è una riga di `Prezzi base`, con `Minimo` e `Massimo` uguali al prezzo dato dal master: `Razione (un giorno)` con l'adattatore D&D 2024, `Pasto semplice` senza adattatore.
- **Deciso (2026-11-14): riga aggiunta in seguito.** Una riga di `Prezzi base` può essere aggiunta più tardi, da un prezzo confermato dal master, una per categoria; valgono le stesse regole di colonna.

```markdown
<!-- yllir
id: economia
-->

# Economia

## Valute

| Valuta | Equivalenza | Nota |
| --- | --- | --- |
| scudo | unità di conto | moneta del porto |
| corona / corone | 10 scudi | una corona vale dieci scudi |

## Prezzi base

| Categoria | Minimo | Massimo | Unità |
| --- | --- | --- | --- |
| Corda | 1 | 3 | scudo |
| Pasto semplice | 0.5 | 1 | scudo |
```

### 4.10 Fazione

**Deciso, 2026-11-11.** Sezione nuova.

**Categoria:** `Fazioni/`, tipo `subjects`. Una fazione è un soggetto con scheda, non un concetto di storia (4.7).
**Metadati:** `id`; `kind: faction`; `template: faction`; `provenance` (vedi 1.2).
**Obbligatorie, in ordine:** titolo; `## Chi sono`, che descrive ciò che i personaggi possono sapere della fazione.
**Facoltative, in ordine:** immagine sotto il titolo; `## Obiettivi`; `## Membri`, l'elenco dei membri noti ai personaggi.
**Blocco riservato:** `### Indicazioni per il master`, `### Segreti` e `### Agganci`.

Un membro punta alla fazione con una voce `member-of` in `relations` della propria scheda. Il legame è dichiarato lì, e non soltanto nella lista di `## Membri`.

```markdown
<!-- yllir
id: gilda-del-sale
kind: faction
template: faction
provenance: master
-->

# Gilda del sale

## Chi sono

Mercanti che controllano le saline della costa e fissano il prezzo del sale per tutto il porto.

## Obiettivi

- Tenere le saline sotto il proprio controllo.

## Membri

- Teodo Marr, capo del borgo.

<!-- master -->
## Master

### Indicazioni per il master

Il capo della gilda non sa che i registri del sale sono falsi.

### Segreti

Il sale del porto è stato venduto due volte allo stesso acquirente.

### Agganci

Chi trova i registri può ricattare il capo del borgo.
<!-- /master -->
```

La scheda del membro dichiara il legame così (esempio fittizio):

```yaml
relations:
  - to: gilda-del-sale
    type: member-of
```

### 4.11 Evento storico

**Deciso, 2026-11-11.** Sezione nuova.

**Categoria:** `Storia/`, tipo `free`.
**Metadati:** `id`; `kind: event`; `template: event`; `provenance` (vedi 1.2); `when`, obbligatorio: la posizione dell'evento sulla cronologia del mondo; `participants` e `location`, facoltativi.
**Obbligatorie, in ordine:** titolo; `## Accaduto`, in prosa al passato.
**Facoltative, in ordine:** `## Conseguenze`.
**Blocco riservato:** `### Indicazioni per il master`.

Un evento storico non è un evento di trama: non ha `depends_on` e non sta in `Trama/`.

```markdown
<!-- yllir
id: incendio-della-torre
kind: event
template: event
provenance: master
when: 312
participants: [gilda-del-sale]
location: [costa-di-selce]
-->

# Incendio della torre

## Accaduto

Nell'anno 312 dell'Ascia un incendio distrugge la torre del sale. La gilda accusa i pescatori, che non ne sono responsabili.

## Conseguenze

Le saline restano senza guardia per tutto l'inverno.

<!-- master -->
## Master

### Indicazioni per il master

Il fuoco è stato appiccato dal tesoriere della gilda.
<!-- /master -->
```

### 4.12 Abbozzo

**Deciso, 2026-11-11.** Sezione nuova. Un abbozzo può avere qualunque tipo.

**Metadati:** `sketch: true`; `kind`; `provenance`; `relations`; `location`, se il soggetto ne ha uno; `template`, per sapere qual è la prima sezione obbligatoria del modello.
**Contenuto:** il titolo e una sola frase sotto la prima sezione obbligatoria del suo modello. Le altre sezioni obbligatorie del modello non sono richieste.

Quando il master nomina l'abbozzo o una sessione lo usa, il framework lo espande in scheda completa. Ogni riga della scaletta che non viene espansa subito si salva come abbozzo (decisione 13 della riprogettazione).

## 5. Controlli: script e giudizio

**Proposta.** Ogni regola sta in uno dei due gruppi. Il controllo deterministico è uno script: produce sempre lo stesso esito dagli stessi file. Il giudizio resta all'agente, e non può essere presentato come un controllo superato.

### 5.1 Controlli comuni a ogni documento

| Controllo deterministico (script) | Giudizio dell'agente |
| --- | --- |
| Metadati: YAML valido, solo i campi ammessi, `id` unico e in forma di slug | Se il titolo descrive davvero il soggetto |
| Un solo titolo `#` (salvo le sessioni); sezioni obbligatorie presenti e nell'ordine del modello | Se la prosa è nel registro scelto (`prose.register`) |
| Blocco riservato: unico, chiuso, ultimo contenuto, con `## Master` come prima riga e solo `###` o inferiori sotto | Se una frase pubblica rivela un segreto del blocco |
| Nessun marcatore del blocco dentro la parte pubblica; nessun blocco di codice nella parte pubblica | Se un fatto è un'ipotesi, uno spunto o un canone |
| Titoli riservati (per esempio `Indicazioni per il master`) solo dentro il blocco | Se una menzione è davvero quel soggetto |
| Link relativi che risolvono; ancore esistenti; nessun link a cartelle derivate | Se il link è utile e non è un'ambiguità |
| Immagini richiamate esistenti; testo alternativo presente | Se il testo alternativo descrive l'immagine |
| Nomi dei file validi e unici nella cartella | — |
| Riferimenti `location`, `depends_on` esistenti; nessun ciclo nelle dipendenze | — |

Nei documenti di `Trama/` il controllo sui blocchi con tre backtick non si applica (vedi 1.8).

### 5.2 Controlli per tipo

| Tipo | Controllo deterministico | Giudizio |
| --- | --- | --- |
| Luogo | sotto-luoghi con scheda omonima; sezioni obbligatorie | coerenza con la scheda del luogo padre; ipotesi e spunti (in `Appunti/`) non presentati come fatti |
| PNG | sezioni obbligatorie e ordine; `location` esistenti | se il PNG combatte e quindi serve `## Statistiche` |
| Nemico | blocco statistiche conforme allo schema dell'adattatore; `location` presente (anche `[]`); titoli riservati solo nel blocco | se la lore e le regole sono scritte nel registro giusto |
| Venditore | colonne della tabella; prezzi nell'unità e negli intervalli, o deroga con motivo; oggetti linkati esistenti | se un prezzo è coerente con il tipo di merce |
| Oggetto | `print` solo con carta; immagine di carta e sorgente `.psd` presenti; `## Effetti` presente; carta marcata da rigenerare se il titolo cambia | se la descrizione è ciò che il personaggio può sapere |
| Annuncio | `## Premio` presente o dichiarato assente; premio scritto `<numero> <valuta>` con una valuta del documento di economia (nessun intervallo: i premi non hanno categoria. Scelta di implementazione (0.61.0), da confermare dall'autore); `location` esistente | se il testo sembra un avviso credibile nel luogo |
| Concetto di storia | sezioni obbligatorie; nessuna sezione di tipo personaggio | coerenza con il canone e con le altre voci di `Storia/` |
| Personaggio giocante | sezioni obbligatorie e ordine; ogni aggancio con le quattro voci e uno stato valido; `level`, se presente, intero positivo; nessun blocco riservato; nessun link pubblico verso `Giocatori/` | se l'integrazione propone canone che va confermato |
| Economia | tabelle con colonne fisse; `Minimo` ≤ `Massimo`, numeri semplici; una sola riga `unità di conto`; equivalenze `<numero> <valuta>` senza cicli; `Luogo` esistenti e `Fattore` positivo; `Unità` dei prezzi base valuta nota; valuta usata dalle schede esiste nel documento | se il sistema di prezzi regge la campagna |
| Sessione | `id` unico; `depends_on` esistenti e senza cicli; file principale coerente con la cartella `Eventi/`; ogni evento con `session` corretta; prove con titolo nel formato dell'adattatore; ogni `id` in `characters` esiste ed è una scheda di personaggio; `enemies`, se presente, ha `id` di schede di creatura esistenti, `count` intero positivo e ogni `id` una sola volta | l'ordine narrativo, la coerenza delle scene e la fedeltà della mappa agli eventi; ogni personaggio nominato che agisce o parla è in `characters`; il testo non definisce né cambia l'identità di un personaggio |
| Cronaca | nome del file uguale alla data nel `id` | fedeltà al registro di sessione |

## 6. Scelte chiarite

- **Stato di stampa:** solo nel metadato `print`, mai nel testo della scheda.
- **Annunci:** stanno in `Oggetti/` e si riconoscono da `template: notice`.
- **Stato dei contenuti:** non serve un campo. Il canone sta nelle schede, gli spunti in `Appunti/`, i segreti nel blocco riservato: la cartella o il blocco dicono già lo stato.

## 7. Questioni aperte

- **Metadati minimi e categorie.** I metadati minimi (`id`, `location`, `depends_on`, `print`), il blocco riservato in fondo alla scheda e le categorie piatte con `Mondo/` a cascata sono ancora **Proposta** (vedi [Principi](Principi.md), punto 4, e [Architettura](Architettura.md), sezione 3). Vanno confermati prima di diventare decisioni.
- **Parte pubblica delle sessioni.** Nessuna uscita legge oggi le sessioni. La sezione 6 presuppone che `Trama/` sia interamente riservata al master: va confermato, oppure va deciso se una sessione ha una parte pubblica.
- **Titolo delle sessioni.** Il file principale ha il nome della sessione come titolo. Va deciso se la cronaca segue la stessa regola.
- **Conclusione della sessione.** Con gli eventi in file separati, la sezione conclusiva (2.7) sta nell'ultimo evento. Va confermato.
- **Campagne già create.** La migrazione che spezza i titoli `#` in file evento e crea la cartella per sessione è descritta in [Aggiornamenti e migrazioni](Aggiornamenti%20e%20migrazioni.md). I link verso le ancore dei vecchi `#` vanno riscritti.
- **Diramazioni.** [Principi](Principi.md), punto 15, copre solo i prerequisiti. La mappa della trama potrebbe aver bisogno di dichiarare anche le uscite (scelte e diramazioni). Non è deciso se servono altri campi o se la mappa le ricava dal testo, che sarebbe una seconda fonte di verità.
- **Modello del venditore.** Il venditore è un PNG con una sezione in più e un valore di `template`, non un tipo separato. Va confermato, perché un modello separato sarebbe più leggibile per i tavoli con molti negozi.
- **Formato del registro `mixed`.** La configurazione ammette `mixed`, ma non è definito quando un testo sia misto né come lo verifica il validatore. Va definito o tolto.
- **Economia e unità.** **In parte risposta (Deciso (2026-11-14)):** le unità di conto stanno nella tabella `Valute` (la riga `unità di conto`), non nei metadati. Resta aperto quanto possa essere largo l'intervallo di un prezzo.
- **Sotto-luoghi.** L'elenco dei sotto-luoghi è derivato dalle cartelle. Non è deciso dove vada scritto per il master (in una vista derivata o non va scritto del tutto).
- **Criterio di ramo (Proposta, 2026-11-09).** Il criterio per riconoscere una biforcazione o un rientro (2.9) è giudicato dall'agente e non è deterministico. Va verificato sui casi reali e, se serve, reso più esplicito nelle regole di 2.9.
- **Campo `characters` (Proposta, 2026-11-09).** Non è deciso se dichiarare i personaggi di un evento con il campo `characters` sia il modo giusto, o se vadano ricavati dai link nel testo. Il campo e il testo sarebbero due fonti di verità da tenere allineate: il rischio va verificato su casi reali. La lista dei nomi con la maiuscola non elencati in `characters` è un'euristica informativa, non un controllo deterministico completo.
