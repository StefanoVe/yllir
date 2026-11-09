# Gestione degli oggetti

**Stato:** Bozza di progetto
**Parte di:** [Skill di libreria](Skill%20di%20libreria.md)

## Scopo del documento

Questo file descrive la skill di libreria che crea e mantiene le schede degli oggetti (`item-manager`). Oggi il catalogo prevede le schede di oggetti dentro la funzione generica [L7, Schede](Skill%20di%20libreria.md#l7-schede), insieme ai luoghi, e nel repository non esiste alcuna skill che scriva la bozza di un oggetto: esiste solo la validazione dell'adattatore del sistema (`validate-sheet` con `KIND=item`). Questo documento propone una skill dedicata, sul modello di `npc-manager`.

Convenzioni: ciò che è **Deciso** dall'autore è dichiarato come tale; il resto è **Proposta**. Nulla qui è ancora implementato. Le questioni aperte sono in fondo e non sono risolte.

## Che cos'è un oggetto

**Deciso (dall'autore, 2026-11-09).** Un oggetto è una **scheda dedicata e collegata** (cioè linkata dalle menzioni, come ogni soggetto con una scheda) che descrive quell'oggetto con quattro parti:

1. descrizione breve pubblica;
2. descrizione completa pubblica;
3. effetti di gioco;
4. note del master.

Le prime tre sono la parte pubblica. Le note del master stanno nel blocco riservato, ultimo contenuto del file (vedi [Formato dei contenuti](Formato%20dei%20contenuti.md), sezione 1.3).

## La skill

- **Nome (proposta):** `item-manager`, skill di libreria in `yllir/skills/library/item-manager/`, con i suoi script accanto a `SKILL.md`.
- **Scopo:** creare la bozza della scheda di un oggetto e controllare che ogni oggetto nominato nei documenti di trama abbia una scheda valida. Non scrive mai un documento della campagna: la bozza passa da `write-sequence`.
- **Avvio:** dal core, quando una scena, una cronaca o un documento importato nomina un oggetto che non ha ancora una scheda (`prepare-session`, `after-session`, `import`); oppure su richiesta («sistema le schede degli oggetti»). Mai chiamata dal master. Non parte in autorun.
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
  - controllo `plot-items`, analogo a `plot-cast`: ogni oggetto citato dai documenti di trama ha una scheda (vedi la questione aperta sul modo di dichiarare gli oggetti negli eventi).
- **Giudizio (agente):**
  - scrittura delle due descrizioni nel tono della campagna (vedi «Tono delle descrizioni»);
  - la separazione fra ciò che i personaggi possono sapere (pubblico) e ciò che sa solo il master (riservato);
  - se un testo di trama contraddice la scheda: è una domanda per il master (`status: ASK`), mai una correzione silenziosa.
- **Dipendenze:**
  - adattatore del sistema di gioco, tramite la skill `system-adapter`: la sezione degli effetti nel formato del sistema e il controllo `validate-sheet` con `KIND=item`, che al passo 3b di `write-sequence` precede la revisione indipendente;
  - documento di economia, in sola lettura, per il valore e il prezzo (opzionale);
  - `write-sequence` per la scrittura, `linker` per i collegamenti, `canon-research` per cercare l'oggetto già stabilito altrove;
  - moduli di output (carte, stampa, enciclopedia), che leggono soltanto la parte pubblica.
- **Modello:** vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md); le istruzioni sono scritte per funzionare con il più debole degli esecutori.

## Modello della scheda

**Proposta.** Il modello estende quello già descritto in [Formato dei contenuti](Formato%20dei%20contenuti.md), sezione 4.5, che oggi ha una sola sezione `## Descrizione` e una sezione `## Effetti`. Per recepire la decisione dell'autore, la descrizione si divide in due.

**Categoria:** `Oggetti/`, tipo `objects`, `template: item`.
**Metadati:** `id`; `template: item`; `location` (dove si trova adesso, lista di `id` di luoghi, `[]` se non ha un luogo fisso); `aliases` facoltativo; `print` solo se la categoria produce carte. Nei metadati non c'è nulla di riservato.

**Sezioni, in ordine:**

| Sezione | Pubblica | Contenuto |
| --- | --- | --- |
| titolo `#` | sì | il nome dell'oggetto |
| `## In breve` | sì | descrizione breve: una o due frasi, quello che si coglie a colpo d'occhio. È il testo che le uscite brevi (carta, tooltip, elenchi) possono riusare. |
| `## Descrizione` | sì | descrizione completa: ciò che i personaggi vedono o sanno, in prosa nel registro della campagna. |
| `## Effetti` | sì | gli effetti di gioco, nel formato dell'adattatore del sistema; senza effetti, «Nessun effetto di gioco». |
| blocco riservato `### Indicazioni per il master` | no | note del master: origine vera, segreti, usi in trama. Ultimo contenuto del file. |

Le sezioni facoltative già previste (`## Origine`, `## Ritrovamento`, `## Testo`, `## Valore`) restano com'erano; l'ordine fra esse e le quattro sopra è una questione aperta.

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
- **Tono delle descrizioni.** **Deciso (dall'autore, 2026-11-09).** Sia la descrizione breve sia quella completa seguono il tono della campagna. Fonti, in ordine di precedenza (proposta):
  1. le regole date dal master a parole in `.campaign/customizations.md` (per esempio «nei dialoghi del porto il tono è ruvido»);
  2. il registro `prose.register` di `campaign.yaml` (`elevated`, `plain`, `colloquial`, `mixed`);
  3. per ciò che le prime due non dicono, il tono delle schede e delle sessioni già scritte nella campagna, che la skill legge prima di scrivere.
  La skill non ha un tono suo e non ne inventa uno. Il tono vale anche per la descrizione breve, che non è una scheda tecnica. Il tono non riguarda `## Effetti`, che segue l'adattatore. Il revisore indipendente controlla il tono insieme al resto; un tono dubbio è una domanda per il master, non una riscrittura silenziosa.
- **Effetti.** Mai scritti a mano fuori dal formato dell'adattatore; la validazione dell'adattatore è obbligatoria prima della revisione. Senza adattatore (`system.adapter: none`) la sezione `## Effetti` resta in testo libero e il controllo dell'adattatore è saltato, dichiarandolo nel rapporto.
- **Collegamenti.** Ogni menzione dell'oggetto in altri documenti diventa un link alla scheda dopo la scrittura, come per ogni soggetto; la scheda è inclusa nell'indice dei soggetti con i suoi alias.
- **Duplicati.** Prima di creare, ricerca per nome e alias. Una corrispondenza esatta non crea nulla e restituisce l'`id` esistente; una parziale genera una domanda per il master («`<nome>` è lo stesso oggetto di `<titolo>`?»).
- **Schede vecchie.** Una scheda esistente non si riscrive in silenzio: la standardizzazione propone le differenze e le applica dopo conferma, conservando ogni contenuto.
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

## Testbench

**Proposta.** Un caso di prova per la modalità `create` e uno per `check`, con campagna sintetica e chiave delle risposte fuori dalla cartella leggibile dall'agente. Trappole da seminare: omonimi (due oggetti con lo stesso nome in luoghi diversi), alias che coincide con il nome di un luogo o di un personaggio, un oggetto citato in trama senza scheda, una scheda con la nota del master fuori dal blocco riservato, una descrizione breve che contraddice la completa, una campagna con registro `plain` e una regola di tono in `customizations.md` che la bozza deve rispettare, un oggetto che la trama fa usare contro ciò che dice la scheda (deve diventare una domanda, non una correzione), un oggetto già escluso nel registro delle esclusioni che non va segnalato. Ogni caso gira più volte per agente e il risultato è un tasso di successo registrato con modello e hash delle istruzioni (vedi [Robustezza e test](Robustezza%20e%20test.md)).

## Questioni aperte

- **Una skill o due.** `item-manager` separato, o funzione unica con i luoghi come in L7 del catalogo? La decisione dell'autore sulle schede dedicate non dice se la skill è separata: la proposta è separata, come `npc-manager`, perché i luoghi e gli oggetti hanno controlli diversi (adattatore, economia, carte).
- **Descrizione breve.** Il modello di 4.5 ha oggi una sola `## Descrizione`: va aggiunta la sezione `## In breve` (proposta di questo documento) o la breve è un campo dei metadati? I metadati non possono contenere testo riservato, ma sono dati di sistema e non contenuto: la proposta è la sezione, non il metadato. Occorre anche decidere se la carta stampata usa la breve o la completa (oggi usa la descrizione, con al massimo otto righe).
- **Ordine delle sezioni facoltative** (`## Origine`, `## Ritrovamento`, `## Testo`, `## Valore`) rispetto alle quattro sezioni fisse.
- **Oggetti negli eventi di trama.** Come si dichiarano gli oggetti usati da un evento? Per i personaggi esiste `characters: [id, ...]`. Un campo analogo (`items`) è una proposta e va deciso, perché il controllo `plot-items` dipende da questo.
- **Oggetti senza effetti.** Un oggetto di sola scena (una lettera, una lanterna) ha davvero bisogno di una scheda, o la soglia è «ha un effetto, un valore o un segreto»? Senza soglia, ogni oggetto citato diventerebbe una scheda.
- **Oggetti con stato.** Un oggetto che cambia nel tempo (si rompe, si identifica, passa di mano) aggiorna la scheda o resta nella cronaca? La proposta è: l'identità nella scheda, le vicende nella cronaca, con `location` come unico dato di stato.
- **Oggetti magici e identificazione.** Il testo pubblico di un oggetto non identificato mostra gli effetti reali o quelli apparenti? Dipende dal sistema di gioco: la decisione spetta all'adattatore o al master?
- **Tono: precedenza e verifica.** L'ordine delle fonti del tono (personalizzazioni, registro, schede esistenti) è una proposta. Resta da decidere se il tono di una scheda si può verificare in modo deterministico o solo con il giudizio del revisore.
- **Prezzi.** La skill legge il documento di economia solo per validare, o propone anche un valore? La proposta è la sola validazione.
- **Nome del campo e della categoria** per sistemi in cui la voce `objects` ha un altro nome nella lingua della campagna: già coperto dal campo `type` in `structure`, da confermare.
