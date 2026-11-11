# Sistemi di gioco e stili

**Stato:** Bozza di progetto. Riscritto dopo la [Riprogettazione](Riprogettazione.md) (2026-11-11).
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

## Scopo

Due moduli opzionali dicono al framework come si comporta una campagna sul piano del gioco e su quello visivo:

- l'**adattatore di sistema** descrive la forma delle schede di un sistema di gioco: quali campi hanno le creature e gli oggetti, quali risorse esistono, quali condizioni e durate, come si esprime una difficoltà, come avanza la campagna. Non contiene le tabelle delle regole;
- il **profilo di stile** descrive l'aspetto visivo di artwork e carte: prompt, palette, cornici, formato, impaginazione.

Entrambi sono dichiarati in `campaign.yaml` (`system.adapter` per l'adattatore; lo stile per categoria sta in `structure[].style`, vedi [Configurazione](Configurazione.md)). Il core non conosce né D&D né uno stile specifico: li legge attraverso il contratto descritto qui.

Decisioni già prese dall'autore:

- D&D 2024 è il primo adattatore; il core non ne contiene nulla (decisione dell'indice);
- l'adattatore è uno **schema**: dichiara la forma delle schede, le scale e ciò che l'agente non decide. Non contiene le tabelle delle regole del gioco. Le statistiche, le difficoltà, i prezzi e gli effetti si scrivono con la conoscenza del modello o con una sua ricerca, senza il blocco riservato del master, e lo schema li valida (**Deciso, 2026-11-11**, decisione 10 e architettura 7 della [Riprogettazione](Riprogettazione.md));
- il modulo di sistema può contenere un file `checks.mjs` con l'aritmetica del sistema (modificatori dai punteggi, punti ferita medi dai dadi, valori di grado di sfida) (**Implementato in 0.30.0**).

Le scelte dell'esempio (progressione, difficoltà, statistiche e stili) non sono decisioni dell'autore: sono descritte in [Scelte di esempio](#scelte-di-esempio). La scelta fra adattatori per sistemi noti e modello generico resta aperta: vedi la sezione dedicata.

## Scelte di esempio

Le scelte seguenti appartengono all'esempio D&D 2024 e ai profili di esempio. Non sono decisioni dell'autore né vincoli del contratto: un altro adattatore o un altro profilo può farne altre.

- la progressione è a milestone, senza punti esperienza;
- la difficoltà si esprime come fascia più GS (grado di sfida);
- le statistiche sono D&D 2024;
- lo stile dei nemici è dark fantasy dipinto; lo stile degli NPC è quello di un antico rotolo dipinto a mano.

## Contratto dell'adattatore di sistema

Un adattatore è uno schema dichiarativo: un manifest YAML con i campi descritti sotto, che il motore valida. Il manifest non contiene le tabelle delle regole (decisione 10 della Riprogettazione). Un modulo di sistema può aggiungere un file `checks.mjs` con i calcoli che non sono tabelle, per esempio la conversione da punteggio a modificatore (**Implementato in 0.30.0**). Il file deve restare puro aritmetico: non tira dadi e non decide esiti.

Superata: la regola precedente «l'adattatore non contiene codice, e un calcolo che non si può esprimere come tabella è un'operazione del core». Ora i calcoli di un sistema stanno in `checks.mjs` del suo modulo, e il core resta senza nomi di sistema.

### Cosa dichiara il manifest

| Campo | Significato | Valori o esempio per D&D 2024 |
| --- | --- | --- |
| `id`, `name`, `version` | identità dell'adattatore | `dnd-2024`, «D&D 2024», `1` |
| `encounters` | se e come il sistema ha combattimenti | `turn-based`: round, iniziativa, azioni |
| `resources` | tipi di risorsa per entità, con massimo e recupero | PF, PF temporanei, slot, usi limitati, ricariche |
| `conditions` | etichette con durata | prono, incapacitato; durata «fino a fine turno», «fino a salvezza» |
| `condition_durations` | durate ammesse per le condizioni | fine turno, fino a salvezza, fino a riposo, fino a rimozione, round |
| `difficulty` | scala e metodo per misurare un incontro | fasce più GS per incontro |
| `progression` | come avanza la campagna e quali eventi la attivano | `milestone`: nessun punto esperienza |
| `creature_sheet` | campi obbligatori e facoltativi della scheda, con etichette in italiano e in inglese | statistiche 2024, capacità, fasi, azioni leggendarie |
| `item_sheet` | campi meccanici e quali di essi sono stampabili sulla carta | effetti, CD, durate; sulla carta solo la narrazione |
| `tracking` | quali strutture usa il tracker degli scontri | ordine di iniziativa, fasi con soglie, ricariche, reazioni |
| `headings` | intestazioni delle sezioni della scheda, in italiano e in inglese | Statistiche, Descrizione, In breve, Effetti |
| `checks` | file facoltativo con l'aritmetica del sistema | `checks.mjs` (modificatori, PF medi, GS, competenza) |
| `do_not` | ciò che l'agente non decide né tira al posto del master | vedi regole comuni |

### Operazioni

Il motore valida la forma delle schede e la loro aritmetica (`check`), e l'adattatore è caricato dalla libreria condivisa (`yllir/scripts/lib/adapter.mjs`). Le operazioni sono in `yllir/scripts/lib/adapter-ops.mjs`, senza più una skill `system-adapter` che le esponga (rimossa dalla Riprogettazione):

- **Implementate in 0.30.0:** `validateSheet` (verifica i campi di una scheda di creatura o di oggetto), `cardFields` (restituisce solo i campi che la carta può stampare), `progressionEvent` (dice se un evento è una milestone dichiarata dal master).

Operazioni previste ma non implementate (**Proposta**):

- `init_encounter(schede, iniziative)`: crea lo stato di partenza con l'iniziativa comunicata dal master;
- `record_event(scontro, evento)`: applica un aggiornamento dichiarato dal master;
- `advance_turn(scontro)`: passa al partecipante successivo dopo conferma;
- `rate_encounter(gruppo)`: restituisce fascia e GS, se il sistema li prevede. Non è implementata perché la tabella fascia-GS manca.

Le ultime tre appartengono al tracker degli scontri, che non esiste ancora nella 0.30.0.

### Regole comuni a ogni adattatore

- **Il master decide.** L'adattatore non tira dadi, non sceglie bersagli, non decide l'esito di attacchi, salvezze o prove. Può ricordare un tiro che la scheda prescrive (esempio di adattatore: una ricarica su 5–6 con un d6), senza eseguirlo.
- **La regola è la fonte.** Resistenze, immunità e riduzioni valgono solo se documentate dalla scheda o dichiarate dal master. L'agente non integra effetti di combattimento non dichiarati. I valori di regola (statistiche, difficoltà, prezzi) si ricavano dalla conoscenza del modello o da una ricerca, e lo schema li valida (decisione 10 della Riprogettazione).
- **Le schede restano dati.** Un adattatore non riscrive la scheda di un personaggio giocante: per i PG registra al più nome, iniziativa e ordine di turno.

## Confronto fra approcci

Tre strade sono possibili. Nessuna è scelta.

**A. Adattatore per ogni sistema noto.** Ogni sistema (D&D 2024, Pathfinder 2e, Blades in the Dark, un sistema della famiglia Powered by the Apocalypse, Call of Cthulhu) è un pacchetto a sé, con il proprio tracker e le proprie schede.

**B. Modello generico.** Il framework conosce solo alcune primitive e ogni sistema è una loro configurazione: entità, risorse, orologi, tracce, condizioni, esiti su scala, fasi opzionali.

**C. Ibrido.** Il modello generico è il linguaggio comune; gli adattatori sono preset che lo riempiono e aggiungono le regole specifiche del sistema.

Sistemi citati nel confronto: D&D 2024 (primo adattatore), Pathfinder 2e, Blades in the Dark, Powered by the Apocalypse e Call of Cthulhu. Le loro regole non sono descritte qui: vanno verificate sul testo del gioco prima di scrivere un adattatore.

La Riprogettazione (decisione 10 e architettura 7) tiene l'adattatore come schema per sistema, ma non sceglie fra A, B e C: la scelta resta aperta.

| Approccio | Pro | Contro |
| --- | --- | --- |
| A | Ogni sistema è fedele alle proprie regole; il master vede termini familiari; i test sono semplici da scrivere per singolo sistema | Il lavoro si moltiplica; le funzioni comuni si duplicano; un sistema nuovo richiede schema e aritmetica nuovi; i giochi narrativi restano fuori o vengono forzati nelle categorie del combattimento |
| B | Copre subito i giochi narrativi (orologi, tracce, esiti su scala); un solo motore da provare; le campagne ibride sono naturali | Le capacità ricaricabili, le azioni e le reazioni di D&D diventano una lista di eccezioni; il rischio di una astrazione che nessun sistema usa davvero; le regole reali restano difficili da verificare |
| C | Il motore è uno solo, ma il master lavora con i termini del suo gioco; i preset di D&D 2024 restano dettagliati; un sistema narrativo richiede solo un preset | Richiede disciplina nel definire le primitive; il confine fra primitiva generica ed eccezione va deciso caso per caso; più lavoro iniziale |

**Modello generico, primitive proposte:**

- **Entità:** PG, PNG, creatura, oggetto, luogo.
- **Risorsa:** un valore con massimo (PF, slot) o un contatore; recupero al riposo, al turno, alla scena o mai.
- **Orologio:** un cerchio di N segmenti che avanza per eventi e, al completamento, scatta una conseguenza dichiarata.
- **Traccia:** una scala ordinata con soglie (stress 0–4, sanità, minaccia), con conseguenze alle soglie.
- **Condizione:** un'etichetta con durata (round, scena, fino a una salvezza, fino a un evento).
- **Esito:** una scala dichiarata (per esempio fallimento, successo con costo, successo pieno), che l'adattatore mappa sulle regole reali.
- **Ciclo:** round o turni opzionali; un giocatore che non usa turni non ha ciclo.

Pro del modello generico: basta una campagna narrativa a usarlo, senza nuovo codice. Contro: il modello deve restare abbastanza semplice da essere verificato, ma abbastanza ricco da esprimere D&D senza eccezioni; un'eccezione in più è spesso la prova che la primitiva manca.

**Decisione aperta.** Né A né B né C è scelta. La proposta del documento è di partire da D&D 2024 come adattatore completo, e di tenere il modello generico solo come bozza fino a quando un secondo sistema reale non la mette alla prova.

## D&D 2024 come primo adattatore

L'adattatore `dnd-2024` è il primo adattatore del framework e descrive la forma di un sistema di gioco completo: scontri a turni, risorse, schede di creature e di oggetti, difficoltà e progressione secondo D&D 2024. Le regole di scrittura delle schede (formato dei testi, separazione fra lore, indicazioni per il master e regole) sono operative nel core e vengono richiamate qui solo per il loro effetto sull'adattatore.

### Manifest

Nel manifest reale sono presenti anche le intestazioni delle sezioni delle schede, oltre ai campi e alle operazioni qui descritti.

- `encounters: turn-based`, con round, iniziativa dichiarata dal master e turni per combattente.
- `resources`: PF e PF temporanei per creature; fasi con soglie; capacità con ricarica; usi limitati; punti per azioni leggendarie; reazioni per turno.
- `conditions`: le quindici condizioni dell'edizione 2024, ciascuna con durata dichiarata.
- `difficulty`: fascia più GS per incontro. La tabella fascia → GS dipende dal numero e dal livello dei PG e sta nell'adattatore, non nel core. Non è ancora presente nel manifest.
- `progression: milestone`. Nessun punto esperienza: un evento di milestone è dichiarato dal master e registrato nella cronaca.

### Scheda creatura

La scheda della creatura (nella categoria delle creature della campagna) contiene tre blocchi che restano distinti, come richiede il contratto delle schede:

1. **Lore e descrizione narrativa**, eventualmente affiancata alle statistiche;
2. **Indicazioni per il master**, nel blocco riservato se contengono segreti;
3. **Regole di gioco**: le statistiche 2024 vere e proprie.

Campi della parte regole:

- CA, PF massimi, velocità;
- punteggi e modificatori di Forza, Destrezza, Costituzione, Intelligenza, Saggezza, Carisma;
- tiri salvezza, abilità, sensi, bonus di competenza, resistenze, immunità quando riportati;
- iniziativa di riferimento, se presente;
- fasi con soglie di PF e le capacità che cambiano;
- capacità con ricarica (dado e intervallo), usi limitati, azioni leggendarie, reazioni, tratti;
- effetti di sconfitta.

Quando un nemico compare più volte, lo stato è per esemplare (nome o identificativo), mentre la scheda è una sola.

L'aritmetica di questi campi è in `checks.mjs` (**Implementato in 0.30.0**): il modificatore di ogni punteggio, i PF medi rispetto alla formula dei dadi, il grado di sfida e il bonus di competenza che ne deriva. Un valore che non torna è un errore del motore, non un'interpretazione dell'agente.

### Tracking dello scontro

Il tracker degli scontri sarebbe la skill `combat-tracker`, che usa l'adattatore per le regole. Non esiste nella 0.30.0 (vedi Stato). Le regole che l'adattatore dichiara e il core dovrebbe far rispettare sono (**Proposta**):

- **Avvio solo quando il combattimento inizia.** Il file dello scontro nasce con lo scontro, non con la preparazione; se esiste già, si riprende senza azzerarlo.
- **Stato per esemplare.** Ogni nemico ha PF attuali e massimi, PF temporanei, fase, condizioni con scadenza, capacità consumate o ricaricabili, azioni e reazioni usate nel turno.
- **PG minimi.** Per i giocatori si registrano solo nome, iniziativa e posizione nel turno. Niente PF, risorse o azioni dei PG.
- **Nessuna azione automatica.** Il tracker non sceglie il bersaglio, non tira dadi, non consuma reazioni o azioni leggendarie: segnala le opzioni disponibili e attende il master.
- **Avanzamento con conferma.** Una singola azione non chiude il turno. Il passaggio al successivo richiede conferma, salvo comando esplicito; all'ultimo partecipante il tracker avvisa che il round finisce.
- **Soglie di fase.** Un nemico che supera una soglia registra la fase una sola volta, con gli effetti immediati evidenziati ma non risolti.
- **Fuori combattimento e sconfitta.** Restano distinti. Il nemico a 0 PF non esce dall'iniziativa: resta con il proprio stato.
- **Scheda cambiata a metà scontro.** Il tracker non riscrive i valori già caricati: segnala la differenza e applica solo le indicazioni del master, annotate.
- **Tre tabelle a ogni aggiornamento:** iniziativa e stato (con il turno corrente marcato), statistiche dei nemici rilevanti, azioni del nemico attivo, che il master sceglie se usare.

### Oggetti

- Gli effetti meccanici hanno attivazione, prova e CD, durata, limiti e risorse. Se l'autore non ha stabilito un effetto, la scheda lo dice: non si assegnano poteri per completarla.
- I campi meccanici restano nella sezione pubblica della scheda, ma la carta illustrata non li stampa: sono esclusi bonus, dadi, CD, sintonia, condizioni, durate, cariche, frequenze d'uso, valori in monete e istruzioni da regolamento. La carta riporta solo testo narrativo conoscibile dai personaggi.
- La `item_sheet` dichiara quali campi sono stampabili: l'elenco vive nell'adattatore, non nella funzione che produce le carte.

### Rischi da evitare

- I nomi dei campi (PF, CD, CA) sono quelli del sistema: restano nell'adattatore, e il core non li usa come proprie parole.
- La separazione fra lore, indicazioni per il master e regole non deve dipendere solo dalle istruzioni: va resa verificabile dal validatore, altrimenti dipende dalla distrazione dell'agente.
- Le istruzioni devono restare essenziali; con un modello economico vanno ridotte alle operazioni, con casi di prova che le verificano.

### Stato dell'implementazione

Stato nella versione 0.30.0 (**Implementato in 0.30.0**, salvo dove è indicato altrimenti):

- L'adattatore è in `yllir/modules/systems/dnd-2024/adapter.yaml`, in YAML ristretto. Dichiara `id`, `name`, `version`, `encounters`, `progression`, `difficulty`, `resources`, `conditions`, `condition_durations`, `creature_sheet`, `item_sheet`, `tracking`, `do_not`, `headings` e `checks`.
- `difficulty` usa il metodo `band-and-cr`, con fasce (`low`, `moderate`, `high`), ma la tabella fascia-GS non è ancora presente.
- `conditions` comprende le 15 condizioni dell'edizione 2024. `creature_sheet` distingue campi obbligatori, con etichette in italiano e inglese, e campi facoltativi; `item_sheet` dichiara i campi meccanici, mentre la carta stampabile contiene solo titolo e descrizione. `headings` definisce le intestazioni delle sezioni statistiche, descrizione ed effetti in italiano e inglese.
- `checks.mjs` nella cartella del modulo contiene solo l'aritmetica: modificatori dei punteggi, PF medi dalla formula dei dadi, valori di grado di sfida e bonus di competenza che ne deriva.
- Il caricamento è in `yllir/scripts/lib/adapter.mjs`, condiviso con la configurazione. Le operazioni sono in `yllir/scripts/lib/adapter-ops.mjs`. Il motore (`commit` e `check`) valida lo schema e le schede di creatura e di oggetto, incluse le verifiche aritmetiche del modulo di sistema; il core non contiene nomi di campi o di regole di un sistema.
- La skill `system-adapter` è rimossa dalla Riprogettazione: il suo compito è passato al motore e alla libreria condivisa.
- `config.mjs` accetta l'id di un adattatore installato oppure `none`.

Non implementato (**Proposta**): le operazioni del tracker degli scontri (`init_encounter`, `record_event`, `advance_turn`) e `rate_encounter`. Il tracker non esiste, e la tabella che associa le fasce ai GS deve essere verificata sul testo ufficiale 2024 prima di essere scritta nell'adattatore. Il metodo è dichiarato, ma la tabella manca.

## Esempio: sistema narrativo senza combattimento a turni

Immaginiamo un gioco narrativo di tensioni fra pescatori e mercanti, con scene e conflitti, senza iniziativa né round. Il suo adattatore, `sale-e-catene` (nome fittizio), dichiara:

```yaml
id: sale-e-catene
encounters: no              # nessun tracker a turni; i conflitti si risolvono per scene
resources:
  - name: Fiducia           # pool che il PG spende e recupera a fine sessione
    max: 6
    recovery: session
clocks:
  - name: Assedio del porto
    segments: 6
    advances_with: master-declared-event
    consequence: la flotta blocca la rada
tracks:
  - name: Stress
    scale: 0-4
    thresholds: {3: «conseguenza di scena», 4: «trauma»}
difficulty: stake           # non esiste un GS; la scena dichiara la posta: basso | alto
progression: objectives     # eventi dichiarati dal master a fine capitolo
npc_sheet:
  required: [nome, luogo, motivazione, legami, tracce]
  optional: [descrizione, segreti-del-master]
```

Che cosa cambia nel framework, rispetto a D&D 2024:

- `encounters: no` nel manifest: il tracker degli scontri non parte e nessuna sezione delle istruzioni lo richiama;
- l'operazione `advance_turn` non esiste; al suo posto c'è `advance_scene`, che chiude la scena con un esito dichiarato dal master;
- gli esiti usano la scala dichiarata dall'adattatore (tre livelli, per esempio), non il confronto con una CD;
- la difficoltà non è una fascia più GS ma la posta della scena, dichiarata prima del tiro;
- la scheda creatura è sostituita dalla scheda del personaggio non giocante, con tracce al posto dei PF;
- la progressione è legata a obiettivi, non a milestone di combattimento.

Che cosa resta uguale: le cartelle, il canone con le schede dedicate, la separazione fra pubblico e master, i collegamenti, l'audit di continuità, l'enciclopedia e la stampa. Il sistema narrativo cambia le regole di gioco, non la manutenzione della campagna.

## Contratto del profilo di stile

Un profilo di stile descrive l'aspetto di una famiglia di immagini: artwork di creature o personaggi, carte di oggetti, manifesti, eventualmente mappe. Il profilo non decide i fatti da rappresentare, che restano nelle schede; decide come vengono dipinti. Il prompt base è in inglese, perché è il testo che legge il generatore; il resto del profilo è in italiano.

### Campi del profilo

| Campo | Contenuto | Esempio |
| --- | --- | --- |
| `id`, `name` | identità del profilo | `dark-fantasy`, «Dark fantasy dipinto» |
| `uses` | categorie e formati che lo usano | `items: card`, `creatures: painting` |
| `base_prompt` | testo fisso per il generatore, con segnaposto `{SUBJECT_DESCRIPTION}` o `{ITEM_DESCRIPTION}` | vedi esempi sotto |
| `constraints` | positivi e negativi: derive da prevenire e attributi da escludere | «nessun cappuccio», «abiti intatti» |
| `palette` | colori dominanti, colori vietati, toni di riferimento | grigi freddi; dorato escluso |
| `frames` | nessuna, cornice o bordo della carta | nessuna per i quadri, bordo per le carte |
| `format` | dimensioni in pixel, proporzioni, risoluzione, sfondo | 1024 × 1536; trasparente per gli oggetti |
| `typography` | font dei titoli e del corpo, dimensioni, righe massime | il font del profilo, 26–28 pt, massimo 8 righe |
| `layers` | livelli obbligatori del file sorgente modificabile | Base, Illustrazione, Titolo, Testo |
| `references` | immagini da allegare alla generazione | base di impaginazione, immagine di oggetto |
| `checks` | elenco di voci da controllare su ogni immagine | abiti, copricapi, oggetti in mano, numero delle figure |

### Dove vive e come cambia (proposta)

Ogni profilo è una cartella: `profile.yaml` con i campi sopra, `prompt.md` con il prompt base e i riferimenti in una sottocartella `references/`. I profili di esempio arrivano con il framework; quelli della campagna stanno nel progetto e possono derivare da un profilo base.

- Un profilo non viene riscritto da un'immagine. Se cambia, si rigenerano solo le immagini richieste; le versioni precedenti restano.
- Non si mescolano profili nella stessa categoria, né si adattano alla preferenza del momento: un soggetto diverso dallo stile si gestisce con una richiesta esplicita per quel soggetto.
- Il profilo non sceglie il motore di generazione. Quello lo sceglie il framework (Riprogettazione, decisioni 3 e 4); Codex, se presente, è al più fornitore di immagini facoltativo (decisione 11).

### Esempio 1: dark fantasy dipinto (creature e oggetti)

Profilo per gli oggetti e per le creature. Lo stile di base è lo stesso; cambia la composizione per usi diversi.

- **Prompt base (in inglese).** Hand-painted digital art with the look of an aged painting: soft brushstrokes, muted shading, imperfect contours; cold, desaturated palette (ash grey, charcoal, dull silver, blue-grey); diffuse light, no rim light, no bloom; no text, frames or signatures.
- **Vincoli contro le derive.** Lo stile tende a rendere cenciosi, laceri o mostruosi anche personaggi ordinari, e ad aggiungere cappucci, bende e armi. Il profilo porta vincoli espliciti, scritti in inglese nel prompt: «intact clothing, ordinary work, NOT torn» e «no hat, no bandage, no unattested weapon».
- **Uso `items: card`.** Oggetto isolato su sfondo trasparente, senza piedistallo né ombra; PNG derivato da un PSD con le misure del formato carta del profilo; livelli Base, Illustrazione, Titolo, Testo; il font del profilo; al massimo otto righe di testo; regole meccaniche escluse dalla carta (vedi la sezione sugli oggetti).
- **Uso `creatures: painting`.** Dipinto verticale 1024 × 1536 px (2:3), creatura intera al 60–70% dell'altezza, sfondo dipinto senza competere con il soggetto, nessuna cornice.
- **Varianti.** Il manifesto di avviso usa lo stesso stile con intestazioni sovrapposte; il profilo dichiara la variante e il font delle intestazioni per area, invece di creare un profilo nuovo.

### Esempio 2: rotolo antico dipinto a mano (personaggi)

Profilo per i personaggi.

- **Prompt base (in inglese).** Vertical scroll on aged silk, painted with controlled ink lines for the figure and ink washes for the setting; colours in translucent glazes with mineral pigments (malachite green, azure, faded cinnabar, ochre, lead white); no inscriptions, red seals or signatures.
- **Vincoli contro le derive.** Lo stile tende ad aggiungere abiti di corte, ornamenti, sigilli e cariche. Il profilo esclude ogni elemento non attestato dalla scheda: il rango e la ricchezza del personaggio non si deducono dallo stile.
- **Uso `characters`.** Figura intera o tre quarti, posa tranquilla, spazio di seta vuoto intorno, ambiente accennato con pochi oggetti e architetture sfumate nella nebbia; 1024 × 1536 px; niente rulli né cornice.

### Verifica comune

Ogni profilo elenca le voci da controllare sull'immagine generata. Le voci dei due esempi sono: abiti e loro stato, copricapi, oggetti in mano, numero e ruolo delle figure, ambiente, presenza di testo o sigilli. Dopo ogni correzione si controllano di nuovo tutte le voci, non solo quelle corrette. Il numero dei tentativi correttivi appartiene alla procedura di generazione, non al profilo. La regola sulla revisione indipendente è limitata dalla decisione 5 della Riprogettazione: un revisore distinto interviene solo sui lotti che aggiungono fatti al canone, e una verifica d'immagine non ne aggiunge.

## Questioni aperte

- **Approccio per gli adattatori.** A, B o C: il confronto sopra non sceglie. Serve un secondo sistema reale per mettere alla prova il modello generico. La Riprogettazione tiene l'adattatore come schema per sistema, senza decidere questa scelta.
- **Ruolo di D&D 2024.** Adattatore autonomo o preset di un modello generico? Dipende dalla scelta precedente.
- **Formato del manifest.** YAML è implementato nella 0.30.0 (`adapter.yaml`, con `checks.mjs` per l'aritmetica). Resta da decidere se il master debba poterlo leggere senza strumenti.
- **Chi scrive un nuovo adattatore.** Proposta: l'agente, a partire dallo schema e da casi di prova; il master lo conferma con una descrizione del sistema. Da verificare con un sistema non noto. Ora che l'adattatore è uno schema, la domanda riguarda anche la forma dei valori di regola (statistiche, difficoltà, prezzi) che il modello scrive e lo schema valida.
- **Fasce di difficoltà.** Tabella fascia → GS nell'adattatore o nella campagna? La proposta è nell'adattatore, con possibilità di personalizzazione per campagna. Finché la tabella manca, `rate_encounter` non è implementata.
- **Procedura di generazione.** Quali parti del processo di artwork appartengono al profilo e quali alla funzione di libreria? Oggi la procedura è tutta in un unico documento di istruzioni.
- **Aritmetica di un secondo sistema (domanda aggiunta dalla riscrittura del 2026-11-11).** `checks.mjs`, con funzioni nominate per il sistema, è il formato definitivo per l'aritmetica, o serve un modo dichiarativo per le formule più semplici?
