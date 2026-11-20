# Atlante

**Stato:** processo, forma e principi **Deciso** dall'autore (2026-11-19); prima implementazione in 0.78.0 (skill `atlas`, sezione Atlante del master screen 0.19.0), con formati e strumenti come descritti qui. La scala `settlement`/`district` (decisione 12, sezione 2b) è implementata nella versione 0.79.0 del framework, con le differenze indicate in sezione 2b. Le scale mescolate (sezione 2b) sono implementate nella versione 0.81.0. L'immagine di partenza (sezione 5c) è implementata nella versione 0.83.0.
**Parte di:** [Skill di libreria](Skill%20di%20libreria.md) (scheda [L25](Skill%20di%20libreria.md#l25-atlante)) e [Master screen](Master%20screen.md)

## Scopo del documento

Questo file definisce l'atlante della campagna: una carta del mondo (o della parte di mondo che serve) costruita per livelli dai documenti della campagna, consultabile nel master screen ed esportabile come sito statico. Le decisioni dell'autore sono marcate **Deciso**. Il resto è **Proposta**, e le questioni aperte in fondo non sono risolte.

Supera, per la carta del mondo, la frase «La carta del mondo resta fuori» della decisione sulle mappe di battaglia (indice, 2026-11-11): le mappe di luogo e di battaglia restano una modalità di `images`, la carta del mondo passa all'atlante.

## 1. Decisioni dell'autore (Deciso, 2026-11-19)

1. **Due forme, un solo atlante.** L'atlante è sia una vista del master screen sia un progetto a sé, inteso come **sito statico esportato**, come l'enciclopedia. Le due forme mostrano gli stessi dati con lo stesso visore.
2. **Solo su richiesta.** L'atlante si genera solo quando il master lo chiede: con una frase, o dalla sezione del master screen. Se non esiste ancora un atlante, la sezione mostra un solo pulsante al centro, «Genera atlante della campagna», che apre un popup con l'assistente e lo crea. Mai in autorun.
3. **Per livelli.** L'atlante si costruisce un livello alla volta (sezione 3), e ogni livello è un insieme di dati separato.
4. **Aspetto alla Inkarnate.** Il risultato deve dare la sensazione di una carta fantasy disegnata con Inkarnate: texture di terra e mare, coste con onde, timbri di montagne, foreste e città, etichette curve. Si imita l'aspetto, non si usa nulla di Inkarnate.
5. **Il più automatico possibile, senza dare nulla per scontato.** L'assistente ricava ciò che può dai documenti della campagna e da fonti esterne; ciò che non può ricavare lo chiede: l'estensione dell'atlante (scope) e i nomi dei luoghi che mancano. Non inventa in silenzio.
6. **Il territorio non cambia.** Una nuova generazione non modifica mai la conformazione del territorio, a meno che il master lo chieda esplicitamente.
7. **Sempre aggiornato.** Quando il mondo si espande, l'atlante si aggiorna con i nuovi luoghi, senza toccare il territorio già fissato.
8. **Geografia come dati (scelta del 2026-11-19).** Il territorio è descritto da dati, livello per livello, e disegnato da un renderer deterministico. Non è un'immagine dipinta da un modello: un'immagine dipinta non garantisce la decisione 6.
9. **Timbri da un pacchetto originale (scelta del 2026-11-19).** Timbri e texture vengono da un pacchetto originale generato una volta con un fornitore di immagini, rifinito e distribuito con il framework.
10. **Master e giocatori (scelta del 2026-11-19).** Nel master screen l'atlante mostra tutto, segreti compresi. Il sito esportato per i giocatori esclude ciò che è riservato al master, con gli stessi controlli dell'enciclopedia.
11. **Stili diversi (Deciso, 2026-11-19).** L'atlante può avere stili diversi. Ogni stile è un pacchetto del framework (timbri, texture, palette, font e parametri di disegno). L'ordine di scelta è: la scelta del master, poi lo stile indicato dall'adattatore del sistema di gioco, poi lo stile di base del framework. Il master cambia stile a voce. Cambiare stile ridisegna solo l'aspetto e non tocca mai i dati, e quindi nemmeno il territorio. I primi stili sono: fantasy colorato (quello di base), pergamena antica e dark fantasy.
12. **Carte di scala più piccola (Deciso, 2026-11-19).** L'atlante non si ferma alla scala geografica (mondo, continente, regione): deve poter rappresentare anche estensioni più piccole, come una città, un villaggio o un quartiere, per esempio quando il mondo della campagna è una sola città. A quella scala servono asset propri: strade, singoli edifici e gli altri elementi di un abitato. Valgono le stesse regole delle altre scale: livelli, vincoli dai documenti, domande su ciò che manca, territorio fissato dopo l'approvazione, stili, versione per i giocatori.

## 2. Dati

**Proposta.** I dati dell'atlante sono canone: stanno nella campagna, nella cartella dell'atlante (localizzata, per esempio `Atlante/`), dichiarata in `structure` con il tipo `atlas`, e si salvano nella cronologia come ogni documento. Tutto ciò che si disegna (immagini, sito) è derivato e si rigenera in `.campaign/cache/atlas/`.

- **`atlas.json` (manifesto):** estensione dell'atlante (mondo, continente o regione, e i luoghi di primo livello che contiene), dimensioni della tela e spazio di coordinate, seme, stile, elenco dei livelli con lo stato di ognuno (`locked`, impronta del contenuto).
- **Un file per livello**, nell'ordine di disegno: `terrain` (terre e mari, coste), `relief` (catene montuose e colline), `water` (fiumi e laghi), `biomes` (foreste, paludi, deserti, ghiacci), `political` (confini), `places` (luoghi), `routes` (strade e rotte), `labels` (solo le correzioni manuali: le etichette si ricavano dagli altri livelli).
- **Ogni elemento** porta le fonti (documento e sezione da cui deriva), la provenienza (`master`, `document`, `agent-choice`) e la visibilità (`public` o `master`).
- **Una sola fonte di verità.** Un luogo dell'atlante si riferisce alla scheda con il suo `id`: nome, descrizione e gerarchia vengono dalla scheda e dalle cartelle dei luoghi, mai copiati. L'atlante aggiunge solo la posizione e l'icona.
- **Confini da regole.** Ogni stato ha punti di partenza sulla terra e regole (stretti da tagliare, isole da includere, laghi da escludere), e lo script calcola il territorio. Non si disegnano poligoni a mano.

## 2b. Scale e carte più piccole

**Implementata in 0.79.0** (decisione 12), con le differenze elencate qui sotto. Il resto della sezione resta **Proposta** dove indicato.

**Differenze rispetto alla proposta (0.79.0):**
- una sola carta per campagna: le carte annidate **non** sono implementate;
- asset urbani disegnati da script in vettoriale: il pacchetto bitmap con fornitore di immagini **non** è fatto;
- costanti scelte: tela predefinita 2400x1800; isolati su griglia da 4 unità; lotti generati dallo script e nascosti sotto gli edifici nominati; marcatori tondi con simbolo per tipo che aprono la sinossi pubblica (scheda senza spoiler).

- **Scale.** All'estensione geografica (`world`, `continent`, `region`) si aggiunge l'estensione di un abitato: `settlement` (città o villaggio intero, con i dintorni) e `district` (un quartiere, un porto, un castello con il borgo). L'estensione decide la tela predefinita e l'unità di misura, ma non limita i livelli. La pianta di un singolo edificio o di uno scontro resta una mappa di luogo di `images` (decisione sulle mappe di battaglia, indice 2026-11-11).
- **Livelli della scala urbana**, nell'ordine di disegno:
  - `ground`: terreno, acqua (fiume, costa, canali), con lo stesso principio di `terrain`;
  - `green`: parchi, giardini, orti, campi e boschi dei dintorni;
  - `walls`: mura, torri e porte, da un tracciato e da regole;
  - `streets`: strade principali, secondarie e vicoli, con ponti e piazze;
  - `blocks`: isolati ricavati dalle strade e riempiti di edifici generici, con seme fisso;
  - `buildings`: edifici singoli nominati nei documenti (taverna, tempio, palazzo, torre, magazzino), ciascuno legato alla sua scheda come i luoghi della scala geografica;
  - `districts`: confini dei quartieri, al posto di `political`;
  - `labels`, come nelle altre scale.
- **Generazione.** Come nelle altre scale: l'assistente scrive i vincoli (andamento del fiume, perimetro delle mura, assi delle strade principali, posizione delle piazze, edifici nominati); gli script generano reticolo stradale, isolati e riempimento con un seme fisso; il master approva; i livelli `ground`, `walls` e `streets` vengono fissati. Gli edifici nominati crescono con il mondo come i luoghi.
- **Asset urbani** (in 0.79.0 disegnati da script in vettoriale; il pacchetto bitmap descritto qui non è fatto). Ogni stile deve avere anche un pacchetto per la scala urbana, generato come quello geografico (decisione 9), con lo stesso stile visivo:
  - edifici generici visti dall'alto o in prospettiva a tre quarti, in varianti di dimensione (casa, casa a schiera, bottega, fienile);
  - edifici notevoli (tempio, palazzo, castello o mastio, torre, taverna, mulino, magazzino, mercato coperto);
  - mura: tratti, torri, porte, con raccordi che si ripetono senza giunte;
  - superfici: lastricato, terra battuta, acciottolato, acqua di canale, prato, campo arato;
  - elementi minori: ponti, moli, barche, alberi isolati, fontane, bancarelle, recinti.
- **Carte annidate** (non implementate in 0.79.0: una sola carta per campagna). Una campagna può avere più carte, ciascuna con la propria estensione (per esempio il mondo e la sua capitale). Ogni carta ha la propria cartella e il proprio manifesto (`Atlante/<carta>/atlas.json`). Il segnaposto di una città sulla carta del mondo apre la carta della città quando esiste. I dati di una carta non si copiano nell'altra: la gerarchia viene dalle cartelle dei luoghi.
- **Città-isola.** Quando il mondo della campagna è una città su un'isola, l'estensione è `settlement` con un'isola, non una carta geografica con un solo punto: la carta urbana copre l'isola, con i suoi quartieri e gli edifici nominati. Il vincolo `island` nel livello `ground` disegna il mare intorno e una sola isola (un'isola per carta), che deve stare dentro la tela con un margine. Le mura seguono la costa dell'isola, con un anello di 10–16 punti preso dal contorno dell'isola e spostato verso l'interno; fuori dalle mura restano campi e riva. *Implementata in 0.79.0 come le altre voci della sezione 2b* (approvazione dell'acqua insieme all'isola, poi livello fissato).
- **Unità.** A scala urbana la tela usa metri o passi, dichiarati nella configurazione, e i controlli sulle posizioni cambiano: un edificio sta su un isolato o su una piazza, mai in strada o in acqua; una porta sta sulle mura.
- **Scale mescolate (implementata in 0.81.0).** Livelli geografici e urbani possono stare nella stessa carta, con una sola tela e un solo sistema di coordinate: l'estensione fissa solo la tela di partenza. Una città dettagliata può stare dentro una carta di regione, disegnata più grande della scala reale perché sia leggibile; attorno a una pianta urbana si possono mettere rilievi e biomi con timbri webp (colline, montagne, foreste). I timbri evitano isolati, verde, piazze e l'interno delle mura. Le unità della tela sono condivise tra i livelli geografici e urbani. Nella carta di regione, mare e isola vengono solo quando manca il livello del terreno; i luoghi dentro un isolato non si disegnano, perché al loro posto ci sono gli edifici.

## 3. Generazione per livelli

**Proposta** nei dettagli; l'ordine per livelli e le domande sono **Deciso**.

1. **Estensione e domande.** L'assistente legge il seme del mondo e le schede dei luoghi. Se la campagna usa un'ambientazione pubblicata, cerca la sua geografia in fonti esterne, senza mai inviare il blocco riservato. Propone l'estensione e chiede solo ciò che non può ricavare: quale parte del mondo, la posizione relativa delle regioni, i nomi che mancano. Le risposte si registrano come provenienza `master`.
2. **Terre e mari.** L'assistente scrive solo vincoli (ancore delle regioni, «costa a ovest», «lago a nord di X», grandezze approssimative); uno script li trasforma in coste con rumore deterministico dal seme. Il master vede un'anteprima e approva. Il livello viene fissato (`locked`).
3. **Rilievi, acque, biomi, confini,** in quest'ordine, con lo stesso schema: vincoli dell'assistente, forme dallo script, anteprima, approvazione, livello fissato.
4. **Luoghi e strade.** Le posizioni vengono dai documenti (relazioni, descrizioni, distanze). Lo script rifiuta una posizione incompatibile con i livelli già fissati (una città in mare, un porto lontano dalla costa). Quando la posizione è ambigua, l'assistente chiede.
5. **Disegno ed esportazione** (sezione 5).

Lo script fa la meccanica, l'assistente giudica: la scelta dei vincoli e la lettura dei documenti sono dell'assistente; forme, posizioni ammesse, impronte e disegno sono dello script.

## 4. Stabilità e aggiornamento

- **Livelli fissati (Proposta).** Uno script di controllo rifiuta ogni scrittura che cambia l'impronta di un livello fissato. Lo si può sbloccare solo su richiesta esplicita del master; in quel caso lo script mostra prima il confronto delle coste e delle aree cambiate, e il master conferma.
- **Allargare il mondo (Proposta).** Nuove terre si aggiungono solo fuori da quelle esistenti, allargando la tela. Le terre esistenti non si ridisegnano.
- **Aggiornamento continuo (Proposta).** Il salvataggio del motore segnala i luoghi del canone che non sono ancora nell'atlante. Quando l'atlante esiste, i processi che creano luoghi (`build-world`, `write-document`) chiamano alla fine del lotto il passo che li colloca, nel rispetto dei livelli fissati. Il master screen mostra quanti luoghi restano da collocare.
- **Ridisegno.** Rigenerare l'atlante significa ridisegnarlo dai dati: con lo stesso seme e gli stessi dati il risultato è identico.

## 5. Disegno, visore ed esportazione

**Proposta.**

- **Renderer deterministico** in Node: dai livelli a SVG e PNG. Riempimenti con texture per terra e mare; coste con doppio tratto e linee d'onda; timbri sparsi con distribuzione regolare e seme fisso dentro le aree di rilievo e di bioma; etichette curve lungo un tracciato, con alone; font con licenza libera distribuiti con il framework.
- **Pacchetto di timbri e texture** (decisione 9): generato una volta, a parte, scontornato e rifinito; sta con la skill, con un manifesto che per ogni elemento indica categoria, dimensioni, punto di appoggio, provenienza e licenza.
- **Visore unico** statico: spostamento e zoom anche con le dita, livelli da accendere e spegnere, ricerca, segnaposti con la scheda del luogo e il collegamento al documento (nel master screen) o alla voce dell'enciclopedia (nel sito dei giocatori), mare che continua oltre i bordi.
- **Esportazione del master** in `.campaign/cache/atlas/master/`, usata dal master screen.
- **Esportazione per i giocatori:** esclude gli elementi con visibilità `master` e il blocco riservato delle schede, e passa i controlli prima della pubblicazione dell'enciclopedia.

## 5b. Versione dipinta (bake)

**Deciso** (decisione dell'autore, 2026-11-20): dopo l'approvazione dell'atlante completo e con il consenso del master, la mappa disegnata viene passata a un fornitore di immagini che ne fa una versione uniforme; il sito serve l'immagine con sopra puntini cliccabili e testi, che non fanno parte dell'immagine.

*Implementata in 0.82.0.*

- **Ingresso.** L'immagine di partenza è la versione per i giocatori dell'atlante: niente testi, niente luoghi riservati, niente segreti. Il fornitore riceve solo questa immagine e lo stile dell'atlante.
- **Rasterizzazione.** La carta vettoriale si rasterizza con resvg e la decodifica WebP usa strumenti installati fuori dal framework alla prima richiesta (`bake-setup`), mai inclusi nel pacchetto.
- **Fornitore.** Si usa un fornitore con immagine di riferimento; oggi è Codex. Se il servizio manca, rifiuta il consenso o fallisce tecnicamente, resta la mappa disegnata: nessun altro servizio viene provato da solo.
- **Controllo.** L'assistente confronta l'immagine di partenza e quella dipinta: la geometria deve restare (coste, montagne, fiumi, strade, mura, edifici nello stesso posto), senza testi né cornici e con un aspetto uniforme. Al massimo due ripetizioni; se la geometria si sposta, il risultato non si tiene.
- **Salvataggio.** La versione dipinta sta nella cartella dell'atlante, in `bake/`, con un solo file per volta: il precedente viene sostituito.
- **Impronta dei livelli.** Il bake registra l'impronta dei livelli disegnati al momento in cui è fatto. Quando strade, terre e gli altri livelli cambiano, il bake diventa obsoleto e il sito mostra da solo la mappa disegnata. Etichette e luoghi non entrano nell'impronta: spostarli o rinominarli non rende obsoleta la versione dipinta.
- **Ripiego.** Senza un sì del master, o se il bake fallisce, resta la mappa disegnata, che è sempre la versione di riferimento.

**Questioni aperte:**

- altri fornitori con immagine di riferimento (ComfyUI, Photoshop), oltre a Codex;
- la registrazione pixel-esatta tra mappa disegnata e dipinta non è verificata dal codice: oggi il controllo è visivo, fatto dall'assistente;
- il costo di ogni rifinitura e chi lo sostiene.

## 5c. Immagine di partenza

**Deciso** (decisione dell'autore, 2026-11-20): prima del bake, nella generazione iniziale, l'assistente può partire da un'immagine trovata nelle fonti o data dal master (per esempio un'isola con una città da costa a costa). L'assistente la legge, ne ricava coste, quartieri, edifici e il resto, e rifà la carta in modalità atlante, che poi può passare al bake.

*Implementata in 0.83.0.*

- **Coerente con la decisione 8.** L'immagine non viene mai dipinta nella carta: viene tracciata in dati (livelli e vincoli), e il disegno resta degli script. Quindi valgono livelli, approvazioni, blocco dei livelli e ripetibilità come sempre.
- **Contorno tracciato.** Un vincolo `landmass` (terre) o `island` (isola della città) può avere un `outline`: il poligono della costa letto dall'assistente. Nelle terre il contorno entra nel campo di terra con un rumore leggero. Nell'isola della città il contorno è la terra, e il mare è la tela meno la terra (baie e porti restano).
- **Comandi.** `init --reference <immagine>` imposta la tela con le proporzioni dell'immagine e ne tiene una copia nella cartella dell'atlante, in `reference/` (una sola immagine alla volta); `reference-set` la aggiunge a un atlante esistente; `reference-grid` mostra l'immagine sulla tela con una griglia numerata, per leggere le coordinate; `reference-overlay` sovrappone il disegno all'immagine per il controllo (al massimo tre giri per livello). Griglia e sovrapposizione sono solo per l'assistente.
- **Provenienza.** Ciò che si ricava dall'immagine ha provenienza `document` con l'immagine come fonte (o `master` per ciò che il master dice a voce). I nomi leggibili sull'immagine contano come nomi dati da un documento se l'immagine è una fonte, come nomi dati dal master se l'ha data lui.
- **Riservatezza.** L'immagine è materiale solo per il master: non va a ricerche, fornitori di immagini né al sito dei giocatori. Il bake riceve solo il disegno fatto dai livelli, mai l'immagine di partenza.
- **Immagine incollata nella conversazione.** Non ha un percorso: passa da `import`, che la tiene come originale nelle fonti, e si usa il percorso dell'originale.

**Questioni aperte:**

- l'immagine è conservata due volte: come originale nelle fonti e come copia in `reference/` dell'atlante. Si può evitare la copia e puntare all'originale? Non deciso.
- se la proporzione dell'immagine non coincide con la tela (atlante già esistente) l'immagine viene stirata sulla tela: va bene, o serve un adattamento?
- tracciare da un'immagine che è un'illustrazione (non una carta piana) può dare contorni imprecisi: serve un controllo più forte del giro di sovrapposizione?

## 6. Master screen

**Proposta** nei dettagli; il pulsante e il popup sono **Deciso**.

- Una sezione «Atlante», visibile quando il modulo è attivo.
- **Senza atlante:** al centro un solo pulsante, «Genera atlante della campagna». Apre un popup con l'assistente, come quello dell'allineamento dopo un aggiornamento: il master segue il lavoro e risponde quando l'assistente gli chiede l'estensione o un nome.
- **Con l'atlante:** il visore, con i livelli e l'avviso dei luoghi da collocare.
- Il master screen non scrive i dati dell'atlante: li scrive l'assistente attraverso gli script della skill.

## 7. Requisiti trasversali

- Il blocco riservato al master non arriva mai al fornitore di immagini (pacchetto di timbri), alle ricerche esterne né al sito dei giocatori.
- Nessun riferimento a un mondo o a un sistema di gioco specifico nel codice: unità di misura, scala e stile vengono dalla configurazione.
- Modulo `atlas` in `modules`, spento per default, attivato con la stessa domanda degli altri moduli.

## 8. Testbench

Campagne sintetiche con risposte fuori dalla cartella che l'agente legge. Casi minimi: l'assistente chiede l'estensione e i nomi mancanti invece di inventarli; un luogo aggiunto con `build-world` viene collocato senza cambiare l'impronta del territorio; un luogo riservato manca dal sito dei giocatori; due luoghi omonimi non si confondono. Per la scala urbana (**Proposta**): una campagna fatta di una sola città produce una carta `settlement`, non una carta geografica; un edificio nominato in un documento viene collocato su un isolato e collegato alla sua scheda; una nuova taverna aggiunta dopo non cambia strade e mura fissate.

## Questioni aperte

- **Allargare la tela:** chi decide dove si attacca una terra nuova, e se il master vuole vedere più proposte.
- **Scala e distanze:** l'atlante deve dichiarare una scala e controllare le distanze scritte nei documenti (giorni di viaggio, leghe)?
- **Griglia esagonale:** serve un livello facoltativo con esagoni per i viaggi?
- **Carte di dettaglio:** in parte risolta dalla decisione 12 (le scale più piccole esistono). Resta da decidere se anche una regione può avere una propria carta più dettagliata dentro quella del mondo (Proposta: sì, con le carte annidate della sezione 2b). Le carte annidate restano **aperte e non implementate** in 0.79.0.
- **Scelta della scala:** quando il mondo è una sola città la scala è ovvia; quando ci sono un mondo e una capitale descritta in dettaglio, l'assistente propone le due carte o chiede quale serve prima? Proposta: propone la carta più ampia e offre la seconda in una frase.
  *Risposta provvisoria adottata (0.79.0):* l'assistente propone la carta più ampia e offre la seconda in una frase.
- **Edifici generici:** il riempimento degli isolati è sempre generato dallo script (`agent-choice`), oppure il master può chiedere un quartiere «povero» o «ricco» che cambia densità e tipi di edifici? Proposta: un parametro di carattere per quartiere, dal documento del quartiere.
  *Risposta provvisoria adottata (0.79.0):* parametro `character` poor|common|rich, preso dalla scheda del quartiere; se la scheda non lo dice, il valore è common.
- **Interni:** la pianta interna di un edificio nominato resta una mappa di luogo di `images`; un collegamento dalla carta della città a quella pianta è utile?
  *Risposta provvisoria adottata (0.79.0):* nessun collegamento.
- **Vedute e carte nautiche:** si ricavano dai livelli dell'atlante (la maschera di terra e mare c'è già) o restano fuori?
- **Pacchetto bitmap urbano:** quando e con quale fornitore di immagini generare i timbri e le texture della scala urbana (sezione 2b, decisione 9), oltre al disegno vettoriale di 0.79.0? Resta aperto.
- **Pubblicazione:** il sito dei giocatori resta locale come l'enciclopedia finché non c'è un hosting.
