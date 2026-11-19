# Atlante

**Stato:** processo, forma e principi **Deciso** dall'autore (2026-11-19); formati e strumenti **Proposta**; nessuna implementazione
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

## 2. Dati

**Proposta.** I dati dell'atlante sono canone: stanno nella campagna, nella cartella dell'atlante (localizzata, per esempio `Atlante/`), dichiarata in `structure` con il tipo `atlas`, e si salvano nella cronologia come ogni documento. Tutto ciò che si disegna (immagini, sito) è derivato e si rigenera in `.campaign/cache/atlas/`.

- **`atlas.yaml`:** estensione dell'atlante (mondo, continente o regione, e i luoghi di primo livello che contiene), dimensioni della tela e spazio di coordinate, seme, stile, elenco dei livelli con lo stato di ognuno (`locked`, impronta del contenuto).
- **Un file per livello**, nell'ordine di disegno: `terrain` (terre e mari, coste), `relief` (catene montuose e colline), `water` (fiumi e laghi), `biomes` (foreste, paludi, deserti, ghiacci), `political` (confini), `places` (luoghi), `routes` (strade e rotte), `labels` (solo le correzioni manuali: le etichette si ricavano dagli altri livelli).
- **Ogni elemento** porta le fonti (documento e sezione da cui deriva), la provenienza (`master`, `document`, `agent-choice`) e la visibilità (`public` o `master`).
- **Una sola fonte di verità.** Un luogo dell'atlante si riferisce alla scheda con il suo `id`: nome, descrizione e gerarchia vengono dalla scheda e dalle cartelle dei luoghi, mai copiati. L'atlante aggiunge solo la posizione e l'icona.
- **Confini da regole.** Ogni stato ha punti di partenza sulla terra e regole (stretti da tagliare, isole da includere, laghi da escludere), e lo script calcola il territorio. Non si disegnano poligoni a mano.

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

Campagne sintetiche con risposte fuori dalla cartella che l'agente legge. Casi minimi: l'assistente chiede l'estensione e i nomi mancanti invece di inventarli; un luogo aggiunto con `build-world` viene collocato senza cambiare l'impronta del territorio; un luogo riservato manca dal sito dei giocatori; due luoghi omonimi non si confondono.

## Questioni aperte

- **Allargare la tela:** chi decide dove si attacca una terra nuova, e se il master vuole vedere più proposte.
- **Scala e distanze:** l'atlante deve dichiarare una scala e controllare le distanze scritte nei documenti (giorni di viaggio, leghe)?
- **Griglia esagonale:** serve un livello facoltativo con esagoni per i viaggi?
- **Carte di dettaglio:** una regione può avere un proprio atlante più dettagliato dentro quello del mondo, o si resta a un solo livello di dettaglio?
- **Vedute e carte nautiche:** si ricavano dai livelli dell'atlante (la maschera di terra e mare c'è già) o restano fuori?
- **Pubblicazione:** il sito dei giocatori resta locale come l'enciclopedia finché non c'è un hosting.
