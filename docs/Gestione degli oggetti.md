# Gestione degli oggetti

**Stato:** Decisioni approvate; la skill non esiste più (Riprogettazione, sezioni 2 e 8)
**Parte di:** [Skill di libreria](Skill%20di%20libreria.md)
Allineato alla [Riprogettazione](Riprogettazione.md) (2026-11-11).

## Scopo del documento

Questo file definisce come si preparano e si controllano le schede di oggetti. La skill di libreria `item-manager` non esiste più: la bozza la prepara l'autore nel lotto di scrittura, e i controlli sono del motore (`check` e `commit`, Riprogettazione, sezioni 2 e 8). I luoghi restano in L7; i personaggi hanno le proprie schede.

Le decisioni dell’autore sono marcate **Deciso**. I dettagli non fissati restano **Proposta** e le questioni aperte in fondo non sono risolte.

## Che cos'è un oggetto

**Deciso (dall'autore, 2026-11-09).** Un oggetto è una **scheda dedicata e collegata** (cioè linkata dalle menzioni, come ogni soggetto con una scheda) che descrive quell'oggetto con quattro parti:

1. descrizione breve pubblica;
2. descrizione completa pubblica;
3. effetti di gioco;
4. note del master.

Le prime tre sono la parte pubblica. Le note del master stanno nel blocco riservato, ultimo contenuto del file (vedi [Formato dei contenuti](Formato%20dei%20contenuti.md), sezione 1.3).

## Chi fa il lavoro

- **Nome (Deciso, 2026-11-10):** `item-manager`, skill di libreria in `yllir/skills/library/item-manager/`, con i suoi script accanto a `SKILL.md`. **Superata dalla Riprogettazione (2026-11-11), sezioni 2 e 8:** la skill non esiste più; le sue funzioni sono dell'autore e del motore.
- **Scopo:** preparare bozze di schede e controllare le schede e i candidati nei documenti di trama. Non scrive mai un documento della campagna: la bozza passa dal motore (`commit`), come ogni scrittura (Riprogettazione, sezione 2).
- **Avvio:** dall'autore, su richiesta del master o quando una scena nomina un oggetto che merita una scheda (Riprogettazione, sezione 8). Non parte in autorun.
- **Input → output:**
  - creazione: nome, luogo (`location`, può essere vuoto), dettagli dati dal master o dal documento → bozza della scheda nella categoria degli oggetti, nel lotto di scrittura;
  - controllo: il motore (`check`) su un elenco di file, o su tutta la campagna → rapporto degli oggetti nominati senza scheda e delle schede che non rispettano il modello.
- **Esito:** il motore risponde in JSON. **Superata dalla Riprogettazione (2026-11-11), sezione 2:** le skill di libreria non restituiscono più un file di rapporto con `status`. Un esito vuoto dichiara la copertura, non si limita a «nessun problema» (principio P1 di [Skill di libreria](Skill%20di%20libreria.md)).

### Che cosa fa il motore e che cosa fa l'autore

- **Deterministico (motore, script `.mjs`):**
  - ricerca di duplicati e omonimi prima di creare (nome e alias, esatto o parziale);
  - scelta della categoria: la voce di `structure` di tipo `objects`; se non c'è, il lavoro si ferma e non crea categorie;
  - generazione dello scheletro dal modello: metadati, titolo, sezioni obbligatorie nell'ordine, blocco riservato nella forma esatta;
  - nome del file e `id` (slug, mai riusato);
  - validazione: sezioni presenti e in ordine, blocco riservato ultimo e unico, nessun segnaposto rimasto, percorsi delle immagini esistenti, `location` che risolve su luoghi esistenti;
  - controllo del campo `items` negli eventi; i candidati trovati nel testo ma omessi dal campo sono presentati all’autore, che giudica identità, pertinenza ed esclusioni.
- **Giudizio (autore):**
  - scrittura delle due descrizioni nel tono della campagna (vedi «Tono delle descrizioni»);
  - la separazione fra ciò che i personaggi possono sapere (pubblico) e ciò che sa solo il master (riservato);
  - identificazione dei candidati trovati nel testo e applicazione delle esclusioni dichiarate; se un testo di trama contraddice la scheda, lo chiede al master, mai correzione silenziosa.
- **Dipendenze:**
  - adattatore del sistema di gioco: la sezione degli effetti nel formato del sistema, validata dal motore contro lo schema dell'adattatore prima della scrittura (Riprogettazione, sezione 7). La skill `system-adapter` e il controllo `validate-sheet` non esistono più;
  - documento di economia, in sola lettura, per la sola verifica del valore (opzionale);
  - il motore (`commit`) per la scrittura e i collegamenti, `query` del motore per cercare l'oggetto già stabilito altrove (Riprogettazione, sezione 2). `write-sequence`, `linker` e `canon-research` non esistono più;
  - moduli di output (carte, stampa, enciclopedia), che leggono soltanto la parte pubblica.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md); le istruzioni sono scritte per funzionare con il più debole degli esecutori.

## Modello della scheda

**Deciso (2026-11-10).** Il modello estende quello già descritto in [Formato dei contenuti](Formato%20dei%20contenuti.md), sezione 4.5, dividendo la descrizione in una breve e una completa.

**Categoria:** `Oggetti/`, tipo `objects`, `template: item`.
**Metadati:** `id`; `template: item`; `kind: item` e `provenance` (Riprogettazione, sezione 3); `location` (dove si trova adesso, lista di `id` di luoghi, `[]` se non ha un luogo fisso); `aliases` facoltativo; `print` solo se la categoria produce carte. Nei metadati non c'è nulla di riservato.

**Sezioni, in ordine (Deciso):**

| Sezione | Pubblica | Contenuto |
| --- | --- | --- |
| titolo `#` | sì | il nome dell'oggetto |
| `## In breve` | sì | una o due frasi su aspetto fisico e funzione essenziale, come li conoscono i giocatori; è il testo che le uscite brevi (carta, tooltip, elenchi) possono riusare. |
| `## Descrizione` | sì | descrizione completa: aggiunge il contesto che i giocatori conoscono o possono cogliere, come provenienza apparente, materiali o usi, quando disponibile, in prosa nel registro della campagna; non si limita a ripetere la breve. |
| `## Effetti` | sì | gli effetti noti ai giocatori, nel formato dell'adattatore del sistema; senza effetti noti, «Nessun effetto di gioco». |
| sezioni facoltative | sì | `## Origine`, `## Ritrovamento`, `## Testo`, `## Valore`, in quest’ordine; ciascuna può essere omessa. |
| blocco riservato `### Indicazioni per il master` | no | il contesto pieno dell'oggetto: che cosa è davvero, origine vera, effetti reali completi, segreti, usi in trama, e che cosa i giocatori non sanno ancora. Ultimo contenuto del file. |

La presenza di una sezione facoltativa non rende pubblica un’informazione riservata: i fatti non noti ai personaggi stanno soltanto nel blocco master. La breve e la completa devono essere coerenti e non contraddirsi; ciascuna include i fatti stabiliti pertinenti al proprio scopo, ma la breve non deve riassumere ogni fatto della completa. Il framework può inventare ciò che le fonti non danno, ma lo dichiara al master e non lo presenta come fonte (Riprogettazione, decisione 7, che sostituisce la regola sull’immaginazione).

Esempio, con valori fittizi (lo schema reale degli effetti è quello dell'adattatore):

```markdown
---
id: lanterna-da-bordo
template: item
kind: item
provenance: master
location: [porto-di-selce]
---

# Lanterna da bordo

## In breve

Una lanterna di ottone dal vetro annerito, usata per illuminare gli ambienti.

## Descrizione

Una lanterna di ottone con il vetro annerito dal fumo. La fiamma è ancora tiepida, come se qualcuno l'avesse spenta da poco. Sul fondo è incisa una sigla quasi illeggibile.

## Effetti

Nessun effetto di gioco.

<!-- master -->
## Master

### Indicazioni per il master

La sigla è quella della nave scomparsa. Chi la riconosce sa dove è stata fabbricata.
<!-- /master -->
```

## Regole di scrittura

- **Fonte di verità.** La scheda è la fonte per che cosa è l'oggetto (aspetto, effetti, origine). Non lo è per ciò che accade in trama: chi lo trova, chi lo perde, che cosa ne fa un personaggio stanno nei documenti di trama e, una volta giocati, nella cronaca. La scheda non registra mai «nella sessione 2 viene rubata».
- **Identità e trama.** Un testo di trama che ha bisogno di un fatto sull'identità dell'oggetto lo scrive prima nella scheda. Se la trama contraddice la scheda, l'autore lo chiede al master.
- **Posizione.** `location` è il luogo attuale, aggiornato dopo la sessione da `after-session` su dichiarazione del master.
- **Riservato.** Le note del master non compaiono mai nelle descrizioni, nelle carte, nelle ricerche web, nei prompt per le immagini né nei revisori di testi destinati ai giocatori. Il passaggio da riservato a pubblico avviene solo per azione esplicita del master. Un rimando a una nota riservata usa l'ancora `#master`.
- **Descrizioni brevi e complete (Deciso, 2026-11-10).** La breve descrive concisamente l’aspetto fisico e la funzione essenziale stabilita. La completa aggiunge il contesto stabilito disponibile, come provenienza, materiali e usi, invece di ripetere soltanto la breve. Entrambe restano coerenti con i fatti noti ai personaggi; non si inventano fatti salvo l’immaginazione descrittiva autorizzata nella richiesta. **Superata dalla Riprogettazione (2026-11-11), decisione 7:** il framework può inventare ciò che le fonti non danno, ma lo dichiara al master.
- **Conoscenza dei giocatori (Deciso, dall'autore, 2026-11-11).** La descrizione breve e quella completa descrivono l'oggetto come lo conoscono i giocatori: ciò che vedono, ciò che è stato detto o identificato al tavolo, ciò che chiunque nel mondo saprebbe. Non anticipano ciò che non sanno (natura nascosta, maledizioni, effetti non identificati, origine vera) e non lo lasciano intuire. Le note del master contengono invece il contesto pieno dell'oggetto, non solo i segreti: che cosa è davvero, origine vera, effetti reali completi, usi in trama e la differenza fra ciò che i giocatori sanno e la verità, così che il master non debba ricostruirlo dalla parte pubblica. Quando i giocatori scoprono qualcosa, il passaggio alla parte pubblica avviene solo per azione esplicita del master (vedi «Riservato»).
- **Tono delle descrizioni (Deciso, 2026-11-10).** Sia la descrizione breve sia quella completa seguono, nell’ordine, le regole del master in `.campaign/customizations.md`, il registro `prose.register` di `campaign.yaml`, e gli esempi già scritti nella campagna per ciò che le prime due fonti non specificano. Il framework non ha un tono suo e non ne inventa uno. Il revisore giudica la coerenza; un tono dubbio è una domanda per il master.
- **Effetti (Deciso, 2026-11-10).** La parte pubblica riporta soltanto gli effetti noti ai personaggi. Gli effetti reali non noti restano nel blocco master. Non si scrivono a mano fuori dal formato dell’adattatore; la validazione è obbligatoria prima della scrittura (Riprogettazione, sezione 7). Senza adattatore (`system.adapter: none`) la sezione `## Effetti` resta in testo libero e il controllo dell'adattatore è saltato, dichiarandolo nel rapporto.
- **Collegamenti.** Ogni menzione dell'oggetto in altri documenti diventa un link alla scheda dopo la scrittura, come per ogni soggetto; la scheda è inclusa nell'indice dei soggetti con i suoi alias.
- **Duplicati.** Prima di creare, ricerca per nome e alias. Una corrispondenza esatta non crea nulla e restituisce l'`id` esistente; una parziale genera una domanda per il master («`<nome>` è lo stesso oggetto di `<titolo>`?»).
- **Identità, stato e cronologia (Deciso, 2026-11-10).** La scheda descrive identità e stato corrente; `location` si aggiorna soltanto su fatti confermati dal master. Le azioni e i passaggi nel tempo restano nei documenti di trama e nella cronaca.
- **Schede esistenti (Deciso, 2026-11-10).** Le schede già presenti vengono adattate dopo l'aggiornamento del framework: una migrazione riprendibile fa valutare le descrizioni brevi e complete a un esecutore economico. **Superata dalla Riprogettazione (2026-11-11), decisioni 4 e 11:** non più Luna, modello di Codex, ora fuori dal framework. La breve espone aspetto e funzione essenziale stabiliti; la completa aggiunge il contesto pubblico già stabilito. Non si inventano fatti. Se manca una base canonica sufficiente, il processo chiede al master e lascia quella scheda in sospeso. **Superata dalla Riprogettazione (2026-11-11), decisione 5 e sezione 2:** il motore applica ogni modifica dopo i suoi controlli, e la revisione di un modello distinto si fa solo per i lotti che aggiungono fatti al canone. `write-sequence` non esiste più; effetti, altre sezioni e blocco riservato restano invariati. Una scheda già adeguata viene registrata come esaminata senza riscriverla. Le campagne che hanno già ricevuto l'aggiornamento che introdusse le descrizioni separate vengono incluse al successivo controllo.
- **Lingua.** Il testo della scheda segue la lingua della campagna; il framework, i nomi interni e le risposte del motore sono in inglese.

## Dove si colloca nel flusso

1. L'autore (per esempio nella preparazione della sessione) nota che una scena nomina un oggetto senza scheda.
2. Prepara la bozza della scheda con nome, luogo e dettagli del master, nel lotto di scrittura (Riprogettazione, sezione 8). Non c'è più una skill dedicata.
3. Nel lotto la bozza è un documento come gli altri, con la sua provenienza (Riprogettazione, sezione 6).
4. Il motore (`commit`) valida formato e schema dell'adattatore, controlla il grafo, risolve i collegamenti e salva la versione. La revisione di un modello distinto si fa solo se il lotto aggiunge fatti al canone (Riprogettazione, decisione 5 e sezione 2).
5. Se c'è una carta, le uscite leggono solo la parte pubblica.

## Rischi da evitare

- una scheda che diventa una seconda trama (azioni e vicende scritte nella scheda);
- effetti di gioco scritti a mano e non validati dall'adattatore;
- note del master finite nella parte pubblica, per esempio dentro la descrizione breve che le uscite riusano;
- una descrizione breve che non dà una visione concisa di aspetto e funzione, oppure una descrizione completa che si limita a ripetere la breve;
- oggetti duplicati con nomi diversi perché la ricerca non ha guardato gli alias;
- un tono scritto nelle istruzioni invece che letto dalla campagna: una descrizione aulica in una campagna sobria (o il contrario) è un errore che l'audit non vede;
- modelli che si moltiplicano per eccezioni fino a non essere più uno standard.

## Quando un oggetto ha una scheda

**Deciso (2026-11-10).** La scheda si crea su richiesta esplicita del master o quando l’oggetto ha effetti di gioco, valore significativo, un segreto o un ruolo nella trama. Gli oggetti di sola scenografia non richiedono scheda.

Gli eventi possono dichiarare gli oggetti con `items: [id, ...]`. Il controllo valida gli ID e presenta all’autore anche candidati trovati nel testo ma omessi dal campo. L’autore decide se sono davvero oggetti da scheda, tenendo conto di omonimi, alias, personaggi o luoghi con nomi simili e delle esclusioni. Un’esclusione dell’oggetto usa `audit.exclusions` con `subject: <id>` e `attribute: plot.items`; l’autore applica il motivo registrato.

## Testbench

**Superata dalla Riprogettazione (2026-11-11), sezione 11:** i casi di prova della skill `item-manager` (`testbench/cases/item-manager/` e `testbench/fixtures/item-manager/`) sono stati tolti con la skill. La misura passa dai tempi massimi e dai casi di generazione, e il testbench misura solo Claude. I risultati riportano solo prove effettivamente eseguite.

## Questioni aperte

- Per oggetti magici non identificati, il principio è fissato («Conoscenza dei giocatori», 2026-11-11): la parte pubblica mostra solo ciò che è noto, il resto sta nelle note del master. Resta aperto se l'adattatore debba fornire un formato per gli effetti parzialmente noti.
- Le schede esistenti scritte prima di «Conoscenza dei giocatori» vanno riesaminate con una migrazione (spostando nel blocco master ciò che i giocatori non sanno), oppure la regola vale solo per le schede nuove?
