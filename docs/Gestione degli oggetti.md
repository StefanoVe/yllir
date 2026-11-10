# Gestione degli oggetti

**Stato:** Decisioni approvate; implementazione in corso
**Parte di:** [Skill di libreria](Skill%20di%20libreria.md)

## Scopo del documento

Questo file definisce la skill di libreria che prepara bozze e controlla schede di oggetti (`item-manager`). La skill non scrive nella campagna: il core passa la bozza al cablaggio di scrittura. I luoghi restano in L7, mentre i personaggi sono gestiti da `npc-manager`.

Le decisioni dell’autore sono marcate **Deciso**. I dettagli non fissati restano **Proposta** e le questioni aperte in fondo non sono risolte.

## Che cos'è un oggetto

**Deciso (dall'autore, 2026-11-09).** Un oggetto è una **scheda dedicata e collegata** (cioè linkata dalle menzioni, come ogni soggetto con una scheda) che descrive quell'oggetto con quattro parti:

1. descrizione breve pubblica;
2. descrizione completa pubblica;
3. effetti di gioco;
4. note del master.

Le prime tre sono la parte pubblica. Le note del master stanno nel blocco riservato, ultimo contenuto del file (vedi [Formato dei contenuti](Formato%20dei%20contenuti.md), sezione 1.3).

## La skill

- **Nome (Deciso, 2026-11-10):** `item-manager`, skill di libreria in `yllir/skills/library/item-manager/`, con i suoi script accanto a `SKILL.md`.
- **Scopo:** creare bozze di schede e controllare le schede e i candidati nei documenti di trama. Non scrive mai un documento della campagna: la bozza passa da `write-sequence`.
- **Avvio:** dal core, su richiesta del master o quando un processo rileva un oggetto meritevole di scheda. Non parte in autorun.
- **Input → output:**
  - modalità `create`: nome, luogo (`location`, può essere vuoto), dettagli dati dal master o dal documento, documenti che lo richiedono → bozza della scheda nella categoria degli oggetti, esito;
  - modalità `check`: elenco di file (vuoto = tutta la campagna) → rapporto degli oggetti nominati senza scheda e delle schede che non rispettano il modello.
- **Esito:** un file di rapporto nello stato del processo, come le altre skill di libreria, con `status` (`DONE`, `ASK`, `FAILED`, `NOT_AVAILABLE`), la copertura (che cosa è stato controllato e con quale comando) e le domande per il master. Un rapporto vuoto dichiara la copertura, non si limita a «nessun problema» (principio P1 di [Skill di libreria](Skill%20di%20libreria.md)).

### Che cosa fa lo script e che cosa fa l'agente

- **Deterministico (script `.mjs`):**
  - ricerca di duplicati e omonimi prima di creare (nome e alias, esatto o parziale);
  - scelta della categoria: la voce di `structure` di tipo `objects`; se non c'è, la skill si ferma e non crea categorie;
  - generazione dello scheletro dal modello: metadati, titolo, sezioni obbligatorie nell'ordine, blocco riservato nella forma esatta;
  - nome del file e `id` (slug, mai riusato);
  - validazione: sezioni presenti e in ordine, blocco riservato ultimo e unico, nessun segnaposto rimasto, percorsi delle immagini esistenti, `location` che risolve su luoghi esistenti;
  - controllo `plot-items`, analogo a `plot-cast`: controllo del campo `items` negli eventi; i candidati trovati nel testo ma omessi dal campo sono presentati all’agente, che giudica identità, pertinenza ed esclusioni.
- **Giudizio (agente):**
  - scrittura delle due descrizioni nel tono della campagna (vedi «Tono delle descrizioni»);
  - la separazione fra ciò che i personaggi possono sapere (pubblico) e ciò che sa solo il master (riservato);
  - identificazione dei candidati trovati nel testo e applicazione delle esclusioni dichiarate; se un testo di trama contraddice la scheda, domanda al master (`status: ASK`), mai correzione silenziosa.
- **Dipendenze:**
  - adattatore del sistema di gioco, tramite la skill `system-adapter`: la sezione degli effetti nel formato del sistema e il controllo `validate-sheet` con `KIND=item`, che al passo 3b di `write-sequence` precede la revisione indipendente;
  - documento di economia, in sola lettura, per la sola verifica del valore (opzionale);
  - `write-sequence` per la scrittura, `linker` per i collegamenti, `canon-research` per cercare l'oggetto già stabilito altrove;
  - moduli di output (carte, stampa, enciclopedia), che leggono soltanto la parte pubblica.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md); le istruzioni sono scritte per funzionare con il più debole degli esecutori.

## Modello della scheda

**Deciso (2026-11-10).** Il modello estende quello già descritto in [Formato dei contenuti](Formato%20dei%20contenuti.md), sezione 4.5, dividendo la descrizione in una breve e una completa.

**Categoria:** `Oggetti/`, tipo `objects`, `template: item`.
**Metadati:** `id`; `template: item`; `location` (dove si trova adesso, lista di `id` di luoghi, `[]` se non ha un luogo fisso); `aliases` facoltativo; `print` solo se la categoria produce carte. Nei metadati non c'è nulla di riservato.

**Sezioni, in ordine (Deciso):**

| Sezione | Pubblica | Contenuto |
| --- | --- | --- |
| titolo `#` | sì | il nome dell'oggetto |
| `## In breve` | sì | descrizione breve: una o due frasi, quello che si coglie a colpo d'occhio. È il testo che le uscite brevi (carta, tooltip, elenchi) possono riusare. |
| `## Descrizione` | sì | descrizione completa: ciò che i personaggi vedono o sanno, in prosa nel registro della campagna. |
| `## Effetti` | sì | gli effetti di gioco, nel formato dell'adattatore del sistema; senza effetti, «Nessun effetto di gioco». |
| sezioni facoltative | sì | `## Origine`, `## Ritrovamento`, `## Testo`, `## Valore`, in quest’ordine; ciascuna può essere omessa. |
| blocco riservato `### Indicazioni per il master` | no | note del master: origine vera, segreti, usi in trama. Ultimo contenuto del file. |

La presenza di una sezione facoltativa non rende pubblica un’informazione riservata: i fatti non noti ai personaggi stanno soltanto nel blocco master.

Esempio, con valori fittizi (lo schema reale degli effetti è quello dell'adattatore):

```markdown
---
id: lanterna-da-bordo
template: item
location: [porto-di-selce]
---

# Lanterna da bordo

## In breve

Una lanterna di ottone con il vetro annerito dal fumo.

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
- **Identità e trama.** Un testo di trama che ha bisogno di un fatto sull'identità dell'oggetto lo scrive prima nella scheda. Se la trama contraddice la scheda, la skill chiede al master.
- **Posizione.** `location` è il luogo attuale, aggiornato dopo la sessione da `after-session` su dichiarazione del master.
- **Riservato.** Le note del master non compaiono mai nelle descrizioni, nelle carte, nelle ricerche web, nei prompt per le immagini né nei revisori di testi destinati ai giocatori. Il passaggio da riservato a pubblico avviene solo per azione esplicita del master. Un rimando a una nota riservata usa l'ancora `#master`.
- **Tono delle descrizioni (Deciso, 2026-11-10).** Sia la descrizione breve sia quella completa seguono, nell’ordine, le regole del master in `.campaign/customizations.md`, il registro `prose.register` di `campaign.yaml`, e gli esempi già scritti nella campagna per ciò che le prime due fonti non specificano. La skill non ha un tono suo e non ne inventa uno. Il revisore giudica la coerenza; un tono dubbio è una domanda per il master.
- **Effetti (Deciso, 2026-11-10).** La parte pubblica riporta soltanto gli effetti noti ai personaggi. Gli effetti reali non noti restano nel blocco master. Non si scrivono a mano fuori dal formato dell’adattatore; la validazione è obbligatoria prima della revisione. Senza adattatore (`system.adapter: none`) la sezione `## Effetti` resta in testo libero e il controllo dell'adattatore è saltato, dichiarandolo nel rapporto.
- **Collegamenti.** Ogni menzione dell'oggetto in altri documenti diventa un link alla scheda dopo la scrittura, come per ogni soggetto; la scheda è inclusa nell'indice dei soggetti con i suoi alias.
- **Duplicati.** Prima di creare, ricerca per nome e alias. Una corrispondenza esatta non crea nulla e restituisce l'`id` esistente; una parziale genera una domanda per il master («`<nome>` è lo stesso oggetto di `<titolo>`?»).
- **Identità, stato e cronologia (Deciso, 2026-11-10).** La scheda descrive identità e stato corrente; `location` si aggiorna soltanto su fatti confermati dal master. Le azioni e i passaggi nel tempo restano nei documenti di trama e nella cronaca.
- **Schede esistenti (Deciso, 2026-11-10).** Non si riscrivono o migrano automaticamente; il controllo segnala le lacune senza normalizzazione implicita.
- **Lingua.** Il testo della scheda segue la lingua della campagna; la skill, i nomi interni e il rapporto sono in inglese.

## Dove si colloca nel flusso

1. Il core (per esempio `prepare-session`) nota che una scena nomina un oggetto senza scheda.
2. Chiama `item-manager` in modalità `create` con nome, luogo e dettagli del master.
3. La skill produce la bozza e la lascia fra le bozze della scrittura.
4. Il core manda la bozza a `write-sequence`: controllo di continuità, validazione dell'adattatore, revisione indipendente, scrittura, collegamenti, file derivati, verifica deterministica, versione salvata.
5. Se c'è una carta, le uscite leggono solo la parte pubblica.

## Rischi da evitare

- una scheda che diventa una seconda trama (azioni e vicende scritte nella scheda);
- effetti di gioco scritti a mano e non validati dall'adattatore;
- note del master finite nella parte pubblica, per esempio dentro la descrizione breve che le uscite riusano;
- la descrizione breve e quella completa che divergono nei fatti: la breve è un riassunto della completa, mai una fonte autonoma;
- oggetti duplicati con nomi diversi perché la ricerca non ha guardato gli alias;
- un tono scritto nella skill invece che letto dalla campagna: una descrizione aulica in una campagna sobria (o il contrario) è un errore che l'audit non vede;
- modelli che si moltiplicano per eccezioni fino a non essere più uno standard.

## Quando un oggetto ha una scheda

**Deciso (2026-11-10).** La scheda si crea su richiesta esplicita del master o quando l’oggetto ha effetti di gioco, valore significativo, un segreto o un ruolo nella trama. Gli oggetti di sola scenografia non richiedono scheda.

Gli eventi possono dichiarare gli oggetti con `items: [id, ...]`. Il controllo valida gli ID e presenta all’agente anche candidati trovati nel testo ma omessi dal campo. L’agente decide se sono davvero oggetti da scheda, tenendo conto di omonimi, alias, personaggi o luoghi con nomi simili e delle esclusioni. Un’esclusione dell’oggetto usa `audit.exclusions` con `subject: <id>` e `attribute: plot.items`; l’agente applica il motivo registrato.

## Testbench

Due casi sintetici separano `create` e `check`; ciascun agente riceve soltanto una copia della campagna e non la chiave. Le trappole e gli esiti attesi sono in `testbench/cases/item-manager/` e `testbench/fixtures/item-manager/`. Il runner registra agente, modello, hash delle istruzioni e tasso di successo. I risultati riportano solo prove effettivamente eseguite.

## Questioni aperte

- Per oggetti magici non identificati, quale contenuto pubblico mostrare dipende dall’adattatore e dai fatti confermati dal master.
