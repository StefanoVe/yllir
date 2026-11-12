# Integrazioni esterne

**Stato:** Bozza di progetto. Riscritto dopo la [Riprogettazione](Riprogettazione.md) (2026-11-11).
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

Questo file descrive i servizi e gli strumenti che il framework può usare oltre al proprio core: generazione e modifica di immagini, Photoshop, documenti, browser, pubblicazione, musica. Descrive anche come il framework capisce cosa è disponibile nella macchina del master e come lo spiega senza gergo. Non stabilisce dettagli di configurazione (vedi [Configurazione](Configurazione.md)) né l'orchestrazione dei modelli (vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md)).

Convenzioni di questo file: ciò che l'autore ha deciso è indicato come **Deciso**, con la data; le scelte di questo documento sono **Proposta**; le informazioni sui servizi di terze parti che non sono verificate sono marcate **DA VERIFICARE**. Non compaiono prezzi né nomi di modelli: non sono stati verificati.

Dalla Riprogettazione Codex non è più parte del framework: resta al più un fornitore di immagini facoltativo, e nulla di ciò che lo riguarda è stato costruito (**Deciso**, 2026-11-11, decisioni 4 e 11). Le sezioni sotto che lo citano lo trattano come uno dei fornitori possibili.

## 1. Principio

- **Le integrazioni sono moduli opzionali.** Ogni integrazione sta dietro un contratto: dichiara quali operazioni offre, che cosa restituisce, di che cosa ha bisogno e come si verifica che funzioni.
- **Il core non dipende da nessuna integrazione.** Il core chiede una capacità («ho bisogno di un'illustrazione con queste proporzioni») e il registro delle integrazioni risponde con il fornitore disponibile. Se non ce n'è nessuno, il core dice che cosa manca e propone l'alternativa.
- **La campagna resta utilizzabile senza integrazioni.** Senza alcun servizio si scrivono schede, si collegano, si controllano, si impaginano le immagini caricate dall'utente e si stampano i fogli. Quello che manca è la generazione di immagini, la composizione in Photoshop e i servizi di riproduzione.
- **Claude, da solo, non genera immagini.** Ogni immagine nasce da un servizio esterno (Photoshop, Codex, un'API, un programma locale) o da un file caricato dall'utente. Questo è un fatto del progetto, non una scelta di comodo.
- **La scrittura creativa non passa da un fornitore di immagini.** Un fornitore riceve solo ciò che il core gli passa (regola 1 della sezione 2) e non partecipa alla scrittura di schede o scene (**Deciso**, 2026-11-11, decisione 4).
- **Richiesta dell'autore.** Il framework deve includere, oltre alle skill nate nel progetto, altre skill e integrazioni utili (per esempio l'MCP di Photoshop) e un modo per generare immagini senza dipendere per forza da Codex.

**Punto di partenza.** Negli strumenti iniziali la generazione di illustrazioni dipende in modo fisso da un solo fornitore (Codex con ImageGen), e alcuni processi vietano di ripiegare su altri generatori; la composizione delle carte dipende anche da Photoshop. Un'impostazione così rende il framework fragile quando il fornitore non è disponibile. Con questo principio quelle dipendenze diventano configurazione, e il divieto diventa una scelta dell'utente (vedi la sezione 2).

## 2. Contratto di un fornitore di immagini

Un **fornitore di immagini** è un'integrazione che sa produrre o modificare immagini. Il contratto prevede cinque operazioni. Ogni fornitore dichiara quali sa fare: il core non tenta le operazioni che il fornitore non dichiara.

| Operazione | Che cosa fa | Ingressi | Uscita |
|---|---|---|---|
| `genera` | Crea un'immagine da una descrizione | Descrizione, proporzioni o pixel, sfondo trasparente sì/no, immagini di riferimento (zero o più) | File dichiarato (PNG in genere) e metadati |
| `modifica_zona` | Cambia solo una parte dell'immagine | Immagine, area (maschera PNG o rettangolo), istruzione | File e metadati |
| `espandi` | Allarga la tela e inventa il contorno | Immagine, direzione, misura, istruzione facoltativa | File e metadati |
| `ingrandisci` | Aumenta la risoluzione per la stampa | Immagine, fattore | File e metadati |
| `togli_sfondo` | Ottiene un PNG con trasparenza reale | Immagine | File con canale alfa |

**Deciso** (2026-11-11, decisione D1): le immagini sono uno strumento di libreria, `images` (yllir:images), raggiunto dall'ingresso: genera un'immagine per un documento della campagna o toglie lo sfondo a un'immagine esistente. Prima versione: solo le operazioni `genera` e `togli_sfondo`; `modifica_zona`, `espandi` e `ingrandisci` restano nel contratto ma non sono realizzate.

**Capacità senza maschera.** Non tutti i fornitori accettano una maschera. Un fornitore senza maschera, se riceve l'intera mappa, tende a ridisegnare le coste e a cancellare i dettagli già presenti: il rischio è concreto e colpisce le mappe più di ogni altra immagine. Il metodo corretto (ritaglio ingrandito, ricomposizione solo sulla zona cambiata, controllo della differenza) può essere svolto dal core stesso. Quindi `modifica_zona` si può offrire anche a fornitori senza maschera, purché il core esegua il ritaglio e la ricomposizione. Proposta: la capacità dichiarata è «modifica di una zona», non «maschera nativa».

### Metadati obbligatori

Ogni immagine prodotta da un fornitore lascia un file di metadati accanto a sé, con lo stesso nome base. Il file di testo con il prompt usato finora accanto all'immagine diventa un campo di questo file. Esempio di contenuto (schema indicativo):

```yaml
image: guardia-del-ponte-artwork.png
operation: genera
provider: codex-imagegen        # quale integrazione ha prodotto il file
provider_version: null          # se il fornitore la dichiara
effective_prompt: "..."           # testo esatto inviato, senza note del master
references: []                   # immagini di partenza usate
parameters:
  aspect_ratio: 2:3
  size: 1024x1536
  transparent_background: false
review: approvata              # esito della verifica visiva
```

Il file serve a tre cose: rifare la stessa immagine, rivederla dopo un cambio di fornitore e dimostrare, in caso di dubbio, quali fonti sono entrate nel prompt. Proposta: il file è un JSON o YAML accanto al PNG, non un testo libero.

### Regole del contratto

1. **Il core filtra prima di inviare.** Il fornitore riceve soltanto ciò che il core gli passa: descrizione verificata, immagini pubbliche, riferimenti di stile. Le note riservate al master non vanno mai a un fornitore esterno: è un requisito di ogni processo di generazione, non una questione di buona volontà del fornitore. Il controllo sta nel core. Per l'immagine di un documento, la descrizione è costruita da uno script dalla sola parte pubblica del documento: il seme del mondo e le categorie riservate al master vengono rifiutati. Un'immagine non aggiunge fatti: aggiungere o cambiare l'immagine sotto il titolo non richiede il revisore (**Deciso**, 2026-11-11, decisione D7).
2. **Lo stile è neutro, la traduzione è del fornitore.** Il profilo di stile della campagna è scritto in un linguaggio indipendente. Ogni fornitore lo traduce nel proprio formato. L'esperienza mostra che la traduzione conta: alcuni generatori rendono cenciosi i personaggi comuni e aggiungono cappucci e armi, e le istruzioni efficaci contrastano questa deriva con vincoli espliciti in positivo e in negativo («intact, ordinary working clothes, NOT rags»). Proposta: queste regole sono una proprietà del profilo di stile, valida per ogni fornitore, e ogni fornitore aggiunge le proprie.
3. **Un fornitore dichiara i propri limiti.** Per esempio: massimo di pixel, formati accettati, presenza o assenza di trasparenza, numero di riferimenti ammessi. Il core adatta la richiesta o, se non è possibile, passa al fornitore successivo.
4. **Nessun segreto nei file di metadati.** Le chiavi API non compaiono mai nei metadati o nei log.

### Ordine di fallback

**Deciso** (2026-11-11, decisione D3). L'ordine è fisso nel framework: non è un'impostazione della campagna. Sostituisce l'ordine proposto in precedenza (`photoshop, codex, third_party_api, local, upload`, con `fallback` configurabile):

1. Servizi aggiunti dal master, dal più recente (decisione D9, sezione 3)
2. ComfyUI (locale)
3. Codex (delega, solo `genera`)
4. generate2dmedia (**Deciso**, 2026-11-11, mappe di battaglia; implementato in 0.41.0): la skill di terze parti `route_media`, che usa il servizio di immagini per cui il master ha dato una chiave, oppure Codex; vedi la sottosezione dopo la tabella della sezione 5
5. Photoshop MCP
6. caricamento manuale (decisione D4: il master dà un file suo e lo strumento lo collega al documento)

**Deciso** (2026-11-11, decisione D9): i servizi aggiunti dal master vengono **prima** dei fornitori del framework, nell'ordine automatico dal più recente al più vecchio. Da quando un servizio è aggiunto, lo strumento lo considera per primo. ComfyUI, Codex, Photoshop e il caricamento manuale restano come ripiego, nello stesso ordine di prima.

Regole decise:

- Lo strumento sceglie da solo il primo fornitore disponibile che supporta l'operazione richiesta.
- Se il master nomina un fornitore, si usa quello. Se non è disponibile, lo si dice al master e non si passa a un altro.
- Il ripiego automatico vale solo per indisponibilità o errore tecnico.

Regole proposte per il fallback:

- Il core usa il primo fornitore dell'ordine che dichiara la capacità richiesta ed è disponibile (vedi [sezione 6](#6-come-il-framework-rileva-cosa-è-disponibile)).
- Si ripiega su un altro fornitore solo per **indisponibilità o errore tecnico**, mai perché il risultato non piace: la revisione resta una decisione dell'autore o dell'agente di revisione.
- Il cambio di fornitore a metà di un ciclo (per esempio una coppia PNG/PSD, o un'artwork con più tentativi) va dichiarato nei metadati e comunicato, perché lo stile può cambiare. Dopo il cambio la verifica visiva si rifà da zero.
- Se nessun fornitore è disponibile, l'operazione si ferma con un messaggio chiaro e propone il caricamento manuale.
- **Deciso** (vedi [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md#fallback)): il ripiego per indisponibilità segue l'ordine fisso del framework (decisione D3, 2026-11-11), e il framework lo comunica al master.

## 3. Fornitori candidati

Tutti i candidati sono opzioni. Nessuno è obbligatorio; l'ordine di scelta è deciso (decisione D3, sezione 2). La difficoltà è stimata per un master che non programma e non ha mai usato un'intelligenza artificiale: **bassa** (basta un clic o una copia), **media** (installazione e un accesso da fare una volta), **alta** (serve configurare un servizio o un computer).

| Fornitore | Operazioni | Pro | Contro | Requisiti | Difficoltà |
|---|---|---|---|---|---|
| **Photoshop MCP** | `genera`, `modifica_zona`, `espandi`, `ingrandisci`, `togli_sfondo`, più la composizione a livelli | Unico candidato che unisce generazione, testo su livelli e PSD a livelli; anteprima per la revisione; ottimo per carte e ritocchi | Richiede Photoshop aperto; le funzioni generative dipendono dalla versione e dall'abbonamento Adobe; costo dell'abbonamento da verificare | Photoshop installato e in esecuzione; MCP di Photoshop collegato; `photoshop_get_capabilities` per sapere quali funzioni sono attive | Media |
| **Codex con ImageGen** (già sperimentato; fornitore facoltativo, nulla costruito) | `genera`; `modifica_zona` solo con ritaglio e ricomposizione del core | Già usato nelle prove; il processo può essere sorvegliato con controlli su blocchi e tempi | Richiede istruzioni molto esplicite; nessuna maschera; comportamento interattivo da sorvegliare; limiti d'uso da verificare | Codex installato e autenticato con un account che ha accesso a ImageGen (DA VERIFICARE) | Media |
| **Server MCP verso API di terzi** (OpenAI, Google, Replicate, fal: DA VERIFICARE) | `genera`; altre operazioni a seconda del servizio (DA VERIFICARE) | Indipendente da Codex e da Photoshop; si sceglie il servizio; automatizzabile | Le operazioni variano da servizio a servizio (DA VERIFICARE); costi a consumo; le immagini e i prompt escono dal computer; la chiave va custodita | Account presso il servizio, chiave API, server MCP da scegliere o scrivere | Media-alta |
| **Generazione locale** (ComfyUI o simili via MCP: DA VERIFICARE) | `genera`, `modifica_zona` a seconda del flusso (DA VERIFICARE) | Nessun costo per immagine; i dati restano sul computer; utilizzabile senza rete dopo l'installazione | Installazione complessa; tempi lunghi; scelta dei modelli difficile; scheda grafica adeguata (requisiti DA VERIFICARE) | Computer con scheda grafica adeguata, spazio su disco, installazione guidata | Alta |
| **Nessun fornitore** (caricamento manuale) | Nessuna generazione: l'utente porta le proprie immagini; il core ritaglia, impagina e stampa | Nessuna dipendenza né costo; piena libertà dell'autore sulle illustrazioni | L'utente fornisce tutte le immagini; senza Photoshop, il PSD a livelli non è disponibile (da decidere); nessuna espansione o rimozione dello sfondo automatica | Solo gli strumenti di impaginazione del core (oggi ImageMagick, da verificare come requisito minimo) | Bassa |

### Note per ciascun candidato

**Fornitori come moduli (Deciso, 2026-11-11, decisione D2).** Ogni fornitore è un modulo in `yllir/modules/image-providers/<id>/provider.yaml`, che dichiara le operazioni che supporta. I fornitori adottati sono ComfyUI (locale), Codex (solo `genera`, come fornitore delegato), Photoshop MCP e il caricamento manuale (decisione D4). L'ordine di scelta è nella sezione 2.

**Photoshop MCP.** Il server espone, tra gli altri: `photoshop_generate_image`, `photoshop_generative_fill`, `photoshop_generative_expand`, `photoshop_generative_upscale`, `photoshop_generative_remove`, `photoshop_create_text_layer`, `photoshop_create_layer`, `photoshop_place_image`, `photoshop_apply_layer_style`, `photoshop_export_as`, `photoshop_save_document`, `photoshop_get_preview`, e le ricette `photoshop_recipe_csv_to_cards`, `photoshop_recipe_remove_background`, `photoshop_recipe_apply_color_grade`, `photoshop_recipe_prepare_for_web`. Richiede Photoshop installato e in esecuzione. Le funzioni generative dipendono dalla versione e dall'abbonamento Adobe: prima di proporle si chiama `photoshop_get_capabilities`. Le funzioni generative non sono un generatore indipendente: producono l'immagine con il servizio di Adobe, quindi il costo e i termini sono quelli dell'abbonamento.

**Codex con ImageGen.** Fornitore già sperimentato per la generazione di artwork e di carte. È un fornitore facoltativo, al più: il framework non dipende da lui e il plugin per Codex è stato rimosso (**Deciso**, 2026-11-11, decisione 11). Il problema emerso nelle prove è l'affidabilità del processo, non la qualità: per questo il processo chiude lo standard input, sorveglia il log e impone un timeout. Il framework dovrà conservare questi controlli, anche quando Codex è un fornitore tra gli altri. Osservazione dell'autore: Codex ha bisogno di istruzioni molto più esplicite di Claude (vedi la [specifica principale](Framework%20per%20campagne%20di%20GDR.md)): ogni fornitore va trattato come un caso a sé nel contratto.

**Server MCP verso API di terzi.** Una strada indipendente dagli altri due. Il framework non dovrebbe includere un fornitore specifico: dovrebbe definire il contratto e lasciare la scelta del servizio all'utente. Ogni servizio ha un proprio elenco di operazioni, di modelli e di condizioni d'uso, che vanno verificati al momento dell'adozione (DA VERIFICARE). Il punto critico per un master è la chiave API: va inserita una volta, conservata fuori dal progetto e mai copiata nei file della campagna.

**Generazione locale: ComfyUI adottato (Deciso, 2026-11-11, decisioni D2 e D3).** ComfyUI è il primo fornitore dell'ordine. Resta aperto l'hardware minimo da dichiarare (DA VERIFICARE). Adatta a chi ha già un computer potente e vuole tenere tutto in casa. Per un master non tecnico è l'opzione più costosa in tempo: la prima installazione va guidata passo per passo. Il framework la propone solo se il controllo capacità (sezione 6) trova il servizio già attivo, oppure con un'istruzione esplicita. Con la decisione D3, lo strumento lo usa da solo quando il controllo lo trova attivo.

**Nessun fornitore.** È la soluzione di base: tutto ciò che il framework fa deve funzionare anche così. Per le carte, senza Photoshop, il PSD a livelli non si produce. Resta da decidere se la carta si costruisca con un compositore a livelli libero, con un file di livelli esportato in altro formato o se il PSD diventi una funzione solo per chi ha Photoshop (vedi [Questioni aperte](#7-questioni-aperte)).

**Scelta predefinita (superata dalla decisione D3, 2026-11-11: vedi sezione 2).** Per il master che non ha un'opinione, l'ordine più sensato è: Photoshop se presente e con funzioni generative attive; altrimenti Codex se installato (fornitore facoltativo); altrimenti il caricamento manuale. Le API e la generazione locale restano opzioni esplicite. Questa proposta dipende dalle risposte alle questioni aperte su costi e dati.

### Servizi aggiunti dal master

**Deciso** (2026-11-11, decisione D9). Il master può aggiungere un proprio servizio parlando, per esempio «crealo con gemini». Il framework non include quel servizio: l'assistente cerca come si usa (la ricerca web contiene solo il nome del servizio, mai dati della campagna) e scrive un adattatore della campagna in `.campaign/image-providers/<id>/`, salvato nella cronologia. Gli adattatori sono di tre tipi:

- `command`: un programma da terminale, eseguito da uno script senza shell, con un timeout e con l'input chiuso.
- `mcp`: uno strumento MCP già collegato all'assistente, con un file di istruzioni.
- `http`: una chiamata web. La chiave non sta mai nei file della campagna: sta in una variabile d'ambiente o nel file locale `.campaign/state/keys.json`, escluso dalla cronologia. Uno script rifiuta l'adattatore se vi trova una chiave.

Un servizio della campagna è sempre esterno, quindi il consenso si chiede una volta (vedi sezione 6). Dalla sua aggiunta, i servizi della campagna vengono prima di quelli del framework nell'ordine automatico (il più recente per primo); ComfyUI, Codex, Photoshop e il caricamento manuale restano come ripiego, nello stesso ordine (sezione 2).

## 4. Photoshop MCP come pilastro della pipeline delle carte

Photoshop è l'unico candidato che copre sia la produzione dell'immagine sia la composizione in un file a livelli modificabile. Per questo è proposto come pilastro delle carte, mentre la stampa resta affidata a strumenti deterministici.

Il flusso è già stato sperimentato: lo strumento apre una base, colloca l'illustrazione, compone titolo e paragrafi con uno script eseguito tramite Photoshop, con il font verificato prima dell'uso. Il PSD a livelli è un requisito fin dall'inizio.

| Funzione | Punto di partenza | Con il framework (proposta) |
|---|---|---|
| Carte degli oggetti | Illustrazione da un generatore; composizione con uno script su una base fissa; PNG esportato; PSD come sorgente per le revisioni | Illustrazione da qualunque fornitore. Il layout diventa un **modello di carta** dichiarato nella configurazione, non codice fisso. Testo su livelli con `photoshop_create_text_layer`, `photoshop_update_text_content` e `photoshop_set_text_font`; PSD a livelli nativo; `photoshop_export_as` per il PNG; `photoshop_get_preview` per la revisione dell'agente prima della consegna |
| Artwork di creature e personaggi | Quadro 2:3 generato con Codex; nessuna elaborazione successiva | Fornitore a scelta per la prima generazione; Photoshop per portare il quadro alle proporzioni volute (`photoshop_generative_expand`), ingrandirlo per la stampa (`photoshop_generative_upscale`) e togliere elementi indesiderati (`photoshop_generative_remove`). Lo sfondo si toglie con `photoshop_recipe_remove_background`, che il server MCP prescrive in sequenza fissa: stato, ricetta, anteprima, poi stop |
| Fogli di stampa | Fogli con ImageMagick, QR deterministici, output sRGB o CMYK | Photoshop non sostituisce l'impaginazione. Il foglio resta uno script deterministico, perché le due esecuzioni devono produrre file identici byte per byte. Photoshop può fornire le carte singole; `photoshop_recipe_csv_to_cards` può produrre una serie a partire da un elenco (formato di ingresso da verificare). Il CMYK di Photoshop è da verificare |

### Regole operative da portare nel framework

Le istruzioni del server MCP fissano alcune pratiche che il framework deve riprendere, invece di lasciarle al caso:

- Il `ping` del server si fa una volta per sessione, non a ogni richiesta.
- Prima di ogni azione su un documento si legge lo stato (`photoshop_get_state`), perché la scheda attiva di Photoshop può cambiare da sola. Il framework blocca l'identificativo del documento (`document_id`) e lo passa a ogni modifica, così la modifica finisce nel file giusto anche quando sono aperti più documenti.
- Le ricette (`photoshop_recipe_*`) si preferiscono a sequenze di cinque o più comandi atomici: una ricetta è un solo passo di annullamento.
- Un'anteprima (`photoshop_get_preview`) è economica e non modifica il file: si fa una volta per passaggio importante, non dopo ogni comando.

### Che cosa cambia per il master

Il master non vede Photoshop: vede una carta. Il framework la produce, mostra l'anteprima, dice che cosa ha cambiato e lascia il PSD come sorgente per le modifiche successive. Se Photoshop non è disponibile, la stessa richiesta va al caricamento manuale o a un altro fornitore, e il risultato non è a livelli: il framework lo dichiara.

## 5. Altre skill e integrazioni utili

Ogni voce indica a cosa serve al master, se è un modulo (un pezzo che si attiva solo se serve) o una libreria (uno strumento usato da più skill), e che cosa richiede. Le voci sono proposte da valutare, non impegni.

| Integrazione | A cosa serve al master | Tipo | Requisiti | Stato |
|---|---|---|---|---|
| **Skill documentali** (PDF, Word, presentazioni: disponibili nell'ambiente di Claude, non nel repository) | Dispense, handout per i giocatori, schede stampabili, riassunti per il master. Per i PDF scansionati serve il riconoscimento del testo (OCR) | Libreria | Un ambiente con Claude e le skill documentali; per l'OCR uno strumento da verificare | Proposta. I documenti per i giocatori passano dal filtro che separa il pubblico dalle note del master |
| **design-taste-frontend** (skill di terze parti, citata per nome) | Cura delle pagine pubbliche e degli strumenti web: enciclopedia, atlante, master screen. Una verifica con ispettore in un browser reale fa parte del processo | Libreria, per le interfacce | Browser e Node | Da valutare con le licenze delle terze parti (DA VERIFICARE). Le interfacce del master vanno tenute semplici, con icone e tooltip |
| **generate2dmap** (skill di terze parti, citata per nome; agent-sprite-forge, MIT) | Mappe di battaglia di un luogo: quadrettatura, raggiungibilità, anteprima navigabile, esportazione per Tiled | Modulo (mappe) | Python gestito dal framework (uv, Python 3.12, numpy, Pillow, scipy); un fornitore di immagini per l'illustrazione | Deciso (2026-11-11). Implementato in 0.41.0: modalità `map` dello strumento `images`. Il framework valida il commit e l'albero git prima di usare il codice, e l'immagine arriva dal fornitore della campagna (vedi la sottosezione seguente) |

### generate2dmap e generate2dmedia (Deciso, 2026-11-11)

Le due skill di terze parti sono fissate a un commit del repository agent-sprite-forge (MIT). Il framework le usa solo dopo averne verificato il commit e gli alberi git delle cartelle usate.

- **Installazione.** Al primo uso di una mappa lo strumento installa il codice in una cartella dei dati del plugin, fuori dalla campagna: clone sparso, commit e alberi git verificati, uv scaricato e controllato con SHA-256, un ambiente Python 3.12 proprio con numpy, Pillow e scipy a versioni fissate. Su macOS, Windows e Linux l'installazione è automatica. Nessuna installazione tocca la campagna, e nessun comando Python viene eseguito fuori da uno script del framework.
- **Fornitore `generate2dmedia`.** È un fornitore di immagini del framework, con questo ordine fisso: servizi aggiunti dal master, ComfyUI, Codex, `generate2dmedia`, Photoshop, caricamento manuale. Riceve solo la descrizione pubblica dell'immagine. L'ambiente di esecuzione è ripulito: contiene solo le chiavi che il master ha dato alla campagna, e la configurazione dell'utente della skill è isolata. Un nome di servizio come «gemini» o «openai» detto dal master diventa una chiave per questo fornitore, mai una variabile d'ambiente letta dalla macchina.
- **Che cosa fa generate2dmap.** Valida il file dei dati della mappa, verifica che ogni punto importante sia raggiungibile, produce l'anteprima navigabile e l'esportazione per Tiled.
- **Che cosa non fa.** Non genera immagini da sé nel flusso di Yllir: l'immagine arriva dal fornitore scelto, con le regole della sezione 2.
- **Griglia.** La griglia sopra la mappa è disegnata da uno script Python di Yllir, `map-grid.py`, che usa Pillow già installato. È un'eccezione motivata alla regola che vuole gli script in Node.js: Node non legge i JPEG e Pillow è già nell'ambiente della mappa. Lo script è deterministico: lo stesso ingresso dà lo stesso file.
- **Universal VTT.** Il file per i tavoli virtuali (formato Universal VTT 0.3) è scritto da Yllir in Node.js, con gli stessi dati del layout della mappa.
| **Browser automatizzato** (Playwright con Chrome di sistema; oppure la skill `claude-in-chrome` di Claude, da verificare) | Verifica dell'enciclopedia prima della pubblicazione: le voci si aprono, i collegamenti non sono rotti, le carte si vedono; anteprime per la revisione | Libreria di verifica | Node, Playwright e Chrome installati; per la skill di Claude, permessi per ogni sito (DA VERIFICARE) | Proposta. Il controllo deterministico dei collegamenti va nel core, il browser serve per l'aspetto |
| **Pubblicazione dell'enciclopedia** (con la CLI del servizio di hosting scelto) | Mettere online le voci per i giocatori o per sé stessi, da un solo comando | Modulo (pubblicazione) | Account di hosting, CLI installata, dominio | Opzionale. Richiede un controllo esplicito sulle parti riservate prima di ogni invio |
| **Musica** (riproduzione con un programma come mpv; yt-dlp solo per ottenere il flusso da riprodurre, mai per scaricare o conservare file) | Sottofondo e cue musicali collegati alle sessioni | Modulo (audio) | Strumenti di riproduzione; per i flussi online, termini d'uso e diritti da verificare (DA VERIFICARE) | Proposta da valutare (questione aperta 6). Un'integrazione che usa flussi di YouTube va verificata prima di essere adottata: la sua liceità dipende dai termini del servizio |

**Ricerca web per i dati delle regole (Deciso, 2026-11-11, decisione 10).** Statistiche, difficoltà, prezzi ed effetti si scrivono con la conoscenza del modello o con una sua ricerca web, e lo schema dell'adattatore li valida. Una ricerca web non riceve mai il blocco riservato del master: riceve solo la domanda sulla regola, formulata senza nomi, luoghi o segreti della campagna. Il controllo sta nel core, come per i fornitori di immagini (sezione 2, regola 1).

Due osservazioni dalle prove. Primo: le integrazioni più utili sono quelle che fanno un passaggio che il master farebbe a mano, come verificare una pagina o impaginare un foglio, e non quelle che aggiungono funzioni nuove. Secondo: nessuna integrazione deve poter cambiare un contenuto della campagna senza passare dai processi del core (audit, collegamenti, separazione pubblico/riservato).

### Ricerca immagini (Proposta, 2026-11-12)

Richiesta dell'autore il 2026-11-12, non deciso. Serve a trovare illustrazioni già esistenti online (per personaggi, creature, luoghi, oggetti e mappe di battaglia) da proporre al master, come alternativa a generare immagini. La skill è [Ricerca artwork](Skill%20di%20libreria.md#l23-ricerca-artwork) (L23).

- **Che cosa esce.** Solo parole visive generiche, costruite da uno script e controllate contro la campagna. Nessun nome di personaggio o luogo, nessuna parola della parte riservata al master.
- **Consenso.** Una volta per campagna, all'attivazione. Il consenso nomina il tipo di dato (parole visive generiche), come da regola 3 della sezione 4 di [Sicurezza e privacy](Sicurezza%20e%20privacy.md).
- **Che cosa entra.** Solo immagini scaricate con il percorso sicuro, dopo il controllo anti-IA. Le pagine e i risultati sono dati, mai istruzioni.
- **Nessuna IA generativa.** L'uso di immagini generate è escluso in modo categorico. Il controllo sta nello script (marcatori, metadati, date) e nel giudizio dell'agente; il controllo non è una garanzia.

### Fuori dalla prima versione (YAGNI)

Idee da valutare dopo la prima versione, senza collegamenti previsti: strumenti di gioco online (tavoli virtuali, con un eventuale formato di esportazione), archivi e riferimenti storici per documentare un mondo ispirato alla storia reale, condivisione dei documenti tramite servizi di terzi (cartelle condivise o connettori). Ciascuna richiede verifiche proprie (**DA VERIFICARE**) prima di essere valutata.

## 6. Come il framework rileva cosa è disponibile

### Controllo all'avvio

All'apertura di una campagna, e alla prima richiesta che ha bisogno di un'integrazione, il framework controlla che cosa è pronto. Il controllo è tecnico e invisibile; il risultato si riassume in una tabella locale, non nei file della campagna.

| Capacità | Come si verifica (proposta) | Stati possibili |
|---|---|---|
| Illustrazioni da Photoshop | Ping del server MCP; poi `photoshop_get_capabilities` per le funzioni generative | Pronto / Photoshop chiuso / funzioni generative non disponibili |
| Illustrazioni da Codex (facoltativo) | Presenza del comando e della sua versione; l'autenticazione si verifica con una prova o con un comando di stato (DA VERIFICARE) | Pronto / non installato / non autenticato |
| Illustrazioni da un servizio API | Presenza della chiave nell'ambiente o nel file locale personale, senza mai stamparla; una prova minima solo con consenso, perché può avere un costo | Pronto / chiave assente / non verificato |
| Generazione locale | Raggiungibilità del servizio sulla macchina (DA VERIFICARE) | Pronto / non avviato / non installato |
| Impaginazione e stampa | Presenza degli strumenti usati dal core (ImageMagick, qrencode, Node) | Pronto / mancante |
| Browser di verifica | Presenza di Chrome e di Playwright | Pronto / mancante |

Il risultato alimenta una tabella di capacità: quali funzioni sono disponibili, con quale fornitore, e che cosa serve per attivarle. Non si ripete il controllo a ogni richiesta: si ripete all'avvio, quando l'utente lo chiede e dopo un aggiornamento del framework (vedi [Aggiornamenti e migrazioni](Aggiornamenti%20e%20migrazioni.md)).

**Deciso** (2026-11-11, decisione D6): la disponibilità dei fornitori e il consenso dato una volta sono nella tabella locale `.campaign/state/image-providers.json`, esclusa dalla cronologia della campagna.

### Che cosa dice all'utente

Il framework non elenca strumenti. Dice che cosa può fare, che cosa gli serve e che cosa succede senza. Esempi di messaggi, in linguaggio comune:

- «Posso creare le illustrazioni direttamente in Photoshop: risulta aperto e le funzioni di generazione sono attive.»
- «Per creare le illustrazioni da solo mi serve Photoshop aperto. Se preferisci, puoi caricare tu le immagini nella cartella dedicata, e le impagino io.»
- «Non trovo nulla che generi immagini sul tuo computer. Posso guidarti nell'installazione di uno dei servizi, oppure lavorare con le immagini che hai già.»
- «Per usare un servizio online serve un account e una chiave. Le immagini e i testi che invio finiscono presso quel servizio: ti chiederò il consenso una sola volta, quando lo attivi.»

Regole di scrittura dei messaggi (proposta, da riprendere in [Esperienza utente](Esperienza%20utente.md)):

- Mai un nome tecnico senza una frase che dica a cosa serve.
- Per ogni integrazione: che cosa abilita, che cosa richiede (un programma, un abbonamento, un account, un'operazione una tantum), che cosa succede se manca.
- Nessun prezzo inventato: se un costo esiste, il messaggio dice che esiste e che va verificato.
- Quando si attiva un servizio che riceve dati dalla campagna, il messaggio dichiara quali dati riceve e chiede il consenso una sola volta (**Deciso**).

## 7. Questioni aperte

1. **Fornitore predefinito.** Per un master che non ha Photoshop né Codex, il framework deve proporre subito il caricamento manuale o un servizio con chiave? Chi sostiene il costo di un servizio a consumo? **Risposta (2026-11-11, D3):** la prima parte è risolta: il primo fornitore disponibile nell'ordine fisso è ComfyUI, poi Codex, poi Photoshop, poi il caricamento manuale. Resta aperta la seconda domanda, sul costo dei servizi a consumo.
2. **PSD senza Photoshop.** Le carte a livelli sono una funzione per chi ha Photoshop, oppure il framework deve produrre un equivalente con un compositore libero? Quale formato a livelli è accettabile per l'autore?
3. **Maschere.** La modifica di una zona senza maschera (ritaglio e ricomposizione del core) è accettabile per tutte le immagini, o solo per le carte della mappa?
4. **Generazione locale.** È un'opzione ufficiale o solo per utenti esperti? Quale hardware minimo dichiarare, e chi lo verifica (DA VERIFICARE)? **Risposta (2026-11-11, D2 e D3):** la generazione locale con ComfyUI è un fornitore adottato ed è il primo dell'ordine. Restano aperti l'hardware minimo da dichiarare e chi lo verifica.
5. **Sincronizzazione dello stile.** Cambiando fornitore, lo stile della campagna resta riconoscibile? Chi decide se una nuova illustrazione è accettabile: l'autore, l'agente di revisione o entrambi? **Risposta parziale (2026-11-11, D5 e D8):** lo stile appartiene alla campagna (`.campaign/styles/`), non al fornitore. Chi approva è l'assistente principale: confronta l'immagine con la descrizione pubblica, tratto per tratto, e il master può chiedere di ripetere il controllo. Resta aperta la domanda sulla riconoscibilità dello stile dopo un cambio di fornitore.
6. **Musica e flussi online.** Un'integrazione può riprodurre audio da YouTube. Si mantiene questa integrazione, si sostituisce con file caricati dall'utente o si esclude? Serve una verifica giuridica dei termini d'uso (DA VERIFICARE)?
7. **Pubblicazione.** L'enciclopedia pubblica resta un'integrazione del framework o un'opzione legata a una sola campagna? Chi controlla che le parti riservate non finiscano online?
8. **Versioni di Photoshop.** Quale versione minima va dichiarata per le funzioni generative, e come si comunica al master che una funzione richiede un abbonamento (DA VERIFICARE)?
9. **Immagini caricate dall'utente.** Quali formati accetta il framework e come si verificano diritti e provenienza delle immagini che il master porta?
10. **Licenze riservate nel repository.** Un'immagine con licenza che ne vieta il riuso può stare nel repository della campagna, che è privato ma sincronizzato con git? **Proposta:** sì, con un avviso di uso privato e nessuna pubblicazione (vedi [Ricerca artwork](Skill%20di%20libreria.md#l23-ricerca-artwork)).
11. **Diritti e provenienza delle immagini trovate.** Estende la domanda 9 alle immagini cercate online: chi verifica la licenza e l'autore, e che cosa succede se la fonte cambia o sparisce?
12. **Regola della data.** La regola «nessuna immagine pubblicata dopo agosto 2022, salvo dichiarazione di assenza di IA» scarta troppo? Quanti risultati dei siti generici sopravvivono davvero?
13. **Ordine delle fonti.** Nella graduatoria le fonti con licenza libera devono avere la precedenza sulle altre?
