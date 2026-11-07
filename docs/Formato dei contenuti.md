# Formato dei contenuti

**Stato:** Bozza di progetto
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

Questo documento definisce la forma dei file che il framework produce e legge: le regole comuni a ogni documento, le convenzioni dei testi di trama, la forma della cronaca, un modello per ogni tipo di scheda, e la divisione fra ciò che controlla uno script e ciò che resta al giudizio dell'agente. Il controllo meccanico è descritto qui in termini di regole; i casi di prova che lo verificano stanno in [Robustezza e test](Robustezza%20e%20test.md).

Convenzione dei marcatori: **Deciso** indica ciò che è fissato dall'indice; tutto il resto è **Proposta** da approvare. Gli esempi sono fittizi. Chiude il documento la sezione [Questioni aperte](#7-questioni-aperte).

## 1. Regole comuni a ogni documento

### 1.1 Titolo

**Proposta.** Ogni scheda ha un solo titolo di primo livello (`#`), che è il nome del soggetto. Le sezioni sono di secondo livello (`##`), le sottosezioni di terzo (`###`). Le sessioni fanno eccezione (vedi sezione 2).

Il titolo è l'unico posto in cui il nome compare come dato: il nome del file lo segue (vedi 1.5), e le uscite lo leggono da lì.

### 1.2 Metadati in testa

**Proposta.** I metadati sono un blocco YAML fra due righe `---`, che è il primo contenuto del file, prima del titolo.

```yaml
---
id: porto-di-selce
location: [costa-di-selce]
---
```

Sono ammessi solo i campi della tabella. Ogni altro campo è un errore: un campo nuovo si aggiunge solo quando una campagna reale lo richiede.

| Campo | Obbligatorio per | Forma | Significato |
| --- | --- | --- | --- |
| `id` | ogni documento della campagna | slug unico in tutta la campagna | identità stabile: route, codici QR, collegamenti |
| `location` | soggetti con una posizione: personaggi, creature, oggetti, annunci | lista di `id` di luoghi; `[]` se non ha un luogo fisso | luogo attuale del soggetto; una creatura che vive in più luoghi li elenca tutti |
| `depends_on` | sessioni e attività di trama | lista di `id` di sessioni o attività; `[]` se non ne ha | prerequisiti (vedi sezione 2) |
| `print` | oggetti con carta | `to-print`, `printed` o `reprint` | stato fisico della carta; è l'unico posto in cui sta |
| `template` | categorie con più modelli: Personaggi (`npc`, `vendor`), Creature (`enemy`, `creature`), Oggetti (`item`, `notice`) | uno dei valori indicati | modello della scheda, da cui il validatore ricava le sezioni obbligatorie |
| `aliases` | facoltativo, per ogni scheda | lista di nomi alternativi | forme alternative del nome; fonte unica per l'indice dei soggetti |
| `merged_ids` | solo dopo un'unione di schede (vedi [Skill di libreria](Skill%20di%20libreria.md#l19-manutenzione-della-continuità)) | lista di `id` | identità assorbite: route e QR già stampati restano validi |

**Chi li scrive.** Solo il framework, nei propri processi. Il master non li modifica a mano; se li apre, li trova leggibili. Il validatore li legge e li verifica, e le risposte al master non li mostrano.

**Regole di forma.**

- Le chiavi sono in minuscolo, con il trattino basso dove serve. Le liste sono in forma `[a, b]`.
- Un `id` è uno slug: solo minuscole, cifre e trattini. Si assegna alla creazione e non cambia mai, neppure quando il titolo cambia.
- I riferimenti (`location`, `depends_on`) puntano sempre a `id`, mai a nomi di file o a link. Così una rinomina non rompe nulla.
- Il nome del soggetto, il tipo e la categoria non si ripetono nei metadati.
- I metadati non contengono nulla di riservato: sono dati di sistema, non contenuto.

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
- I testi della campagna sono nella lingua di `language.primary`. I titoli delle sezioni dei modelli (`## Descrizione`, `## Effetti` e le altre) sono contenuto della campagna e si traducono dalla lingua configurata; i nomi dei metadati e dei tipi restano in inglese, come nel resto del framework.

## 2. Testi di trama (sessioni e attività)

I testi di trama stanno nella categoria `Trama/`, con un file per sessione o per attività. Le attività minori seguono la stessa forma e si distinguono solo per il titolo.

### 2.1 Metadati

**Proposta.**

- `id` e `depends_on` sono obbligatori. Una sessione senza prerequisiti dichiara `depends_on: []`, così il vuoto è esplicito e non è una dimenticanza.
- `depends_on` elenca gli `id` delle sessioni o attività che devono essere giocate prima. Non conta l'ordine dei file: solo il campo crea una dipendenza.
- `location` è facoltativo e indica il luogo principale della scena.

```yaml
---
id: il-faro-spento-02
depends_on: [il-faro-spento-01]
location: [porto-di-selce]
---
```

### 2.2 Gerarchia dei titoli

**Proposta.** Nei testi di trama i livelli dei titoli indicano il tipo di passaggio:

| Livello | Forma | Uso |
| --- | --- | --- |
| `#` | `# Titolo` | evento principale: una scena, un incontro, un passaggio significativo |
| `##` | `## Titolo` | azione o evento minore dentro la scena: esplorazione, interazioni, passaggi secondari |
| `###` | `### Titolo` | prova o azione circoscritta: un singolo tentativo con il suo esito |

Un file di trama non ha un titolo di documento separato: il nome del file è il titolo, e il primo `#` apre il primo evento.

### 2.3 Prove ed esiti

**Proposta.** Il titolo `###` di una prova riporta abilità e difficoltà nel formato dell'adattatore di sistema (vedi [Sistemi di gioco e stili](Sistemi%20di%20gioco%20e%20stili.md)). Sotto il titolo, gli esiti sono una lista con le parole chiave `Successo` e `Fallimento`. Nell'esempio, valori e testi sono fittizi: il formato reale lo fornisce l'adattatore.

```markdown
### Prova di abilità, difficoltà 13

- **Successo:** la figura raggiunge il muro senza essere vista.
- **Fallimento:** la guardia si volta e blocca il passaggio.
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

### 2.7 Conclusione

**Proposta.** Una sessione può chiudersi con una sezione in prosa che descrive dove porta la scena. Questa sezione non è una fonte di dati: le dipendenze della mappa della trama vengono solo dal campo `depends_on`, mai dal testo.

## 3. Pagina di cronaca

**Proposta.** La cronaca racconta ciò che è accaduto al tavolo, ed è scritta dal processo «dopo la sessione» a partire dal registro di sessione (L18 in [Skill di libreria](Skill%20di%20libreria.md#l18-registro-di-sessione)). Sta nella categoria `Cronaca/`, con un file per serata chiamato con la data.

```markdown
---
id: cronaca-2026-11-14
---

# Il faro si spegne

## Accaduto

Il gruppo scende al porto all'alba e trova la lanterna spenta. Ilde Varno non risponde alla porta.

## Fili aperti

- Il registro del faro è sparito.
```

La forma minima è: metadati con `id`, titolo `#`, una sezione `## Accaduto` in prosa al passato, e facoltativamente `## Fili aperti` come lista. Un blocco riservato è facoltativo. La cronaca non riscrive l'identità di nulla e non anticipa ciò che non è ancora accaduto.

## 4. Modelli per tipo

Ogni modello indica la categoria, i metadati, le sezioni obbligatorie e facoltative nell'ordine in cui compaiono, il blocco riservato e un esempio breve. Il tipo di una categoria è il campo `type` della sua voce in `structure` (vedi [Configurazione](Configurazione.md)): `plot`, `chronicle`, `places`, `subjects`, `objects`, `free` o `master-only`.

### 4.1 Luogo

**Categoria:** cartella a cascata in `Mondo/`, tipo `places`.
**Metadati:** `id`.
**Obbligatorie, in ordine:** titolo; `## Descrizione`, che si apre con un paragrafo in corsivo.
**Facoltative, in ordine:** immagine sotto il titolo; `## Da definire` (obbligatoria se restano lacune).
**Blocco riservato:** `### Indicazioni per il master`. Gli spunti non canonici non stanno nella scheda: stanno in `Appunti/`.

Un luogo con sotto-luoghi è una cartella con la scheda omonima dentro. L'elenco dei sotto-luoghi non si scrive a mano: si ricava dalla posizione delle cartelle, come indice derivato.

```markdown
---
id: costa-di-selce
---

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
**Facoltative, in ordine:** immagine sotto il titolo (ritratto); `## Statistiche`, obbligatoria se il PNG può combattere; `## Assortimento`, per i venditori (4.4); `## Da definire`.
**Blocco riservato:** `### Indicazioni per il master`, con motivazioni e segreti.

Un PNG che svolge più ruoli usa il modello più ricco e dichiara le sezioni facoltative che usa. Non si crea una scheda per ciascun ruolo (L14 in [Skill di libreria](Skill%20di%20libreria.md#l14-gestione-dei-png)).

```markdown
---
id: ilde-varno
template: npc
location: [porto-di-selce]
---

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

### 4.3 Nemico (creatura)

**Categoria:** `Creature/`, tipo `subjects`.
**Metadati:** `id`; `template`: `enemy` per una creatura che combatte, `creature` per una che non combatte (animali, cavalcature); `location`, obbligatorio: la lista di tutti i luoghi in cui vive, `[]` se è errante.
**Obbligatorie, in ordine:** titolo; `## Natura`, lore pubblica su ciò che la creatura è e su ciò che i personaggi possono sapere di lei; `## Statistiche`, con il blocco fornito dall'adattatore. Se la creatura non combatte (`template: creature`), la sezione dichiara «Nessuna statistica: non combatte».
**Facoltative, in ordine:** immagine sotto il titolo; `## Bottino`, con il valore ricavato dal documento di economia; `## Da definire`.
**Blocco riservato:** `### Indicazioni per il master`, con condotta, tattica, quando fugge e segreti.

Il modello separa tre cose in tre posti: la lore sta nella parte pubblica (`## Natura`), le regole nella parte pubblica (`## Statistiche`, con il formato dell'adattatore), le indicazioni per il master solo nel blocco riservato. Un testo di condotta non sta mai fra le sezioni pubbliche.

```markdown
---
id: guardiano-di-sale
template: enemy
location: [costa-di-selce]
---

# Guardiano di sale

## Natura

_Una creatura bassa e massiccia, coperta di cristalli di sale, che sorveglia le saline._

## Statistiche

Esempio con valori fittizi (lo schema reale è quello dell'adattatore): Minaccia 2 · Parametro A 14 · Parametro B 30
Attacco: colpo, danno da taglio pari a un dado più un modificatore.

<!-- master -->
## Master

### Indicazioni per il master

Si ritira verso l'acqua quando scende sotto la metà dei punti struttura.
<!-- /master -->
```

### 4.4 Venditore

**Categoria:** `Personaggi/`, come un PNG.
**Modello:** il modello del PNG (4.2), con `template: vendor` e in più le sezioni che seguono. Un venditore non ha un modello separato: la sezione `## Assortimento` e il valore `template: vendor` lo rendono tale.
**Obbligatorie aggiuntive:** `## Assortimento`, tabella con colonne `Oggetto`, `Prezzo`, `Nota`.
**Facoltative aggiuntive, in ordine:** `## Trattare`, con il modo di contrattare, in prosa pubblica; `## Deroghe`, obbligatoria se un prezzo esce dagli intervalli.
**Regole dei prezzi:** ogni prezzo è espresso nell'unità del documento di economia (vedi 4.9) e cade nell'intervallo del suo oggetto o nella variazione del luogo. Una deroga è sempre dichiarata con il motivo nella sezione `## Deroghe`.

```markdown
## Assortimento

| Oggetto | Prezzo | Nota |
| --- | --- | --- |
| Corda di canapa | 2 scudi | prezzo di base |
| Lanterna da mare | 6 scudi | |
```

### 4.5 Oggetto (con carta)

**Categoria:** `Oggetti/`, tipo `objects`, con `template: item`. La categoria produce carte se la sua voce in `structure` dichiara `cards: true`.
**Metadati:** `id`; `template: item`; `location` (dove si trova adesso, come lista); `print`, solo per gli oggetti con carta.
**Obbligatorie, in ordine:** titolo; immagine di carta sotto il titolo, se la categoria produce carte; `## Descrizione`, ciò che i personaggi vedono o sanno; `## Effetti`, nel formato dell'adattatore, oppure «Nessun effetto di gioco».
**Facoltative, in ordine:** `## Origine`, pubblica solo se i personaggi possono conoscerla; `## Ritrovamento`; `## Testo`, per il testo integrale di una lettera o di un libro (prosa normale, senza corsivo); `## Valore`, che segue il documento di economia.
**Blocco riservato:** `### Indicazioni per il master`, con l'origine vera e i segreti.

**Regole della carta.**

- L'immagine finale è `img/<nome-base>.png`, con il sorgente `img/<nome-base>.psd` accanto.
- Il titolo stampato sulla carta è il titolo `#` della scheda. Quando il titolo cambia, la carta è marcata come da rigenerare: se era `printed`, passa a `reprint`.
- Una carta già stampata mantiene il nome del file: i codici QR puntano all'`id`, quindi non si rinomina per non rompere la stampa.

```markdown
---
id: lanterna-da-bordo
template: item
location: [porto-di-selce]
print: to-print
---

# Lanterna da bordo

![Lanterna di ottone con vetro annerito](img/lanterna-da-bordo.png)

## Descrizione

Una lanterna di ottone con il vetro annerito dal fumo. La fiamma è ancora tiepida.

## Effetti

Nessun effetto di gioco.
```

### 4.6 Annuncio di bacheca

**Categoria:** `Oggetti/`: un annuncio è un oggetto (la carta appesa alla bacheca) con `template: notice`. Nessuna categoria in più (YAGNI).
**Metadati:** `id`; `template: notice`; `location`, con il solo luogo della bacheca; `print` se l'annuncio ha una carta.
**Obbligatorie, in ordine:** titolo; `## Testo`, il testo dell'annuncio come è affisso; `## Premio`, con la ricompensa in unità del documento di economia, oppure «Nessun premio».
**Facoltative, in ordine:** immagine di carta sotto il titolo; `## Indizi`, ciò che il lettore può ricavare dall'annuncio.
**Blocco riservato:** `### Indicazioni per il master`, con il committente vero, le condizioni nascoste e l'esito reale.

```markdown
---
id: taglia-sul-falsario
template: notice
location: [porto-di-selce]
---

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
---
id: patto-del-faro
---

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
**Metadati:** `id`.
**Obbligatorie, in ordine:** titolo; `## Scheda`, con i dati trascritti del personaggio nei campi dell'adattatore; `## Integrazione con la trama`, con ganci, segreti innestabili e rimandi alle sessioni.
**Facoltative, in ordine:** `## Background`, come lo scrive il giocatore; `## Domande aperte`, da porre al giocatore; `## Originali`, con i link ai file in `Fonti/`.
**Blocco riservato:** non si usa. L'intero file è riservato, e nessuna scheda pubblica linka questa categoria.

Un'integrazione che propone canone resta una proposta finché il master non la conferma. Il personaggio giocante non definisce l'identità di altri soggetti: quella sta nelle loro schede.

```markdown
---
id: pietro-sala
---

# Pietro Sala

## Scheda

Mestiere: pilota di chiatte. Forza di volontà alta, forza fisica media.

## Integrazione con la trama

- Gancio: il padre di Pietro lavorava al faro, e conosce il custode.
- Segreto innestabile: un debito con il Patto del faro.

## Domande aperte

- Il giocatore vuole che il padre sia ancora vivo?
```

### 4.9 Documento di economia

**File:** `Storia/Economia.md`, unico nella campagna, con percorso fisso. Nasce la prima volta che serve un prezzo, un salario o una ricompensa, non all'intervista di creazione.
**Metadati:** `id: economia`.
**Obbligatorie, in ordine:** titolo; `## Valute`, tabella con colonne `Valuta`, `Equivalenza`, `Nota`; `## Prezzi base`, tabella con colonne `Categoria`, `Minimo`, `Massimo`, `Unità`; `## Salari`, tabella con colonne `Mestiere`, `Paga`, `Periodo`; `## Variazioni per luogo`, tabella con colonne `Luogo`, `Fattore`, `Motivo`, dove `Luogo` è un `id`.
**Facoltative, in ordine:** `## Deroghe in vigore`, con luogo, periodo e motivo di ogni deroga; `## Da definire`.
**Blocco riservato:** `### Indicazioni per il master`, con le cause che tengono i prezzi a quei livelli.

I numeri usano il punto come separatore decimale, così il controllo dei prezzi è sicuro.

```markdown
---
id: economia
---

# Economia

## Valute

| Valuta | Equivalenza | Nota |
| --- | --- | --- |
| scudo | unità di conto | moneta del porto |

## Prezzi base

| Categoria | Minimo | Massimo | Unità |
| --- | --- | --- | --- |
| Corda | 1 | 3 | scudo |
| Pasto semplice | 0.5 | 1 | scudo |
```

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
| Annuncio | `## Premio` presente o dichiarato assente; premio negli intervalli di economia; `location` esistente | se il testo sembra un avviso credibile nel luogo |
| Concetto di storia | sezioni obbligatorie; nessuna sezione di tipo personaggio | coerenza con il canone e con le altre voci di `Storia/` |
| Personaggio giocante | sezioni obbligatorie; nessun link pubblico verso `Giocatori/` | se l'integrazione propone canone che va confermato |
| Economia | tabelle con colonne fisse; `Minimo` ≤ `Massimo`; `Luogo` esistenti; valuta usata dalle schede esiste nel documento | se il sistema di prezzi regge la campagna |
| Sessione | `id` unico; `depends_on` esistenti e senza cicli; titoli `#` come eventi; prove con titolo nel formato dell'adattatore | l'ordine narrativo e la coerenza delle scene |
| Cronaca | nome del file uguale alla data nel `id` | fedeltà al registro di sessione |

## 6. Scelte chiarite

- **Stato di stampa:** solo nel metadato `print`, mai nel testo della scheda.
- **Annunci:** stanno in `Oggetti/` e si riconoscono da `template: notice`.
- **Stato dei contenuti:** non serve un campo. Il canone sta nelle schede, gli spunti in `Appunti/`, i segreti nel blocco riservato: la cartella o il blocco dicono già lo stato.

## 7. Questioni aperte

- **Metadati minimi e categorie.** I metadati minimi (`id`, `location`, `depends_on`, `print`), il blocco riservato in fondo alla scheda e le categorie piatte con `Mondo/` a cascata sono ancora **Proposta** (vedi [Principi](Principi.md), punto 4, e [Architettura](Architettura.md), sezione 3). Vanno confermati prima di diventare decisioni.
- **Parte pubblica delle sessioni.** Nessuna uscita legge oggi le sessioni. La sezione 6 presuppone che `Trama/` sia interamente riservata al master: va confermato, oppure va deciso se una sessione ha una parte pubblica.
- **Titolo delle sessioni.** Il modello di trama non ha un titolo di documento, perché il primo `#` è un evento. Va confermato, e va deciso se la cronaca segue la stessa regola.
- **Diramazioni.** [Principi](Principi.md), punto 15, copre solo i prerequisiti. La mappa della trama potrebbe aver bisogno di dichiarare anche le uscite (scelte e diramazioni). Non è deciso se servono altri campi o se la mappa le ricava dal testo, che sarebbe una seconda fonte di verità.
- **Modello del venditore.** Il venditore è un PNG con una sezione in più e un valore di `template`, non un tipo separato. Va confermato, perché un modello separato sarebbe più leggibile per i tavoli con molti negozi.
- **Formato del registro `mixed`.** La configurazione ammette `mixed`, ma non è definito quando un testo sia misto né come lo verifica il validatore. Va definito o tolto.
- **Economia e unità.** Non è deciso se le unità di conto vadano sempre nei metadati o solo nella tabella, né quanto possa essere largo l'intervallo di un prezzo.
- **Sotto-luoghi.** L'elenco dei sotto-luoghi è derivato dalle cartelle. Non è deciso dove vada scritto per il master (in una vista derivata o non va scritto del tutto).
