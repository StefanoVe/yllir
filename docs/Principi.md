# Principi di progetto

**Stato:** Bozza di progetto
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

Questo documento fissa i principi che guidano ogni scelta del framework e il glossario dei termini tecnici. I principi valgono per il core, per le skill di libreria, per i moduli e per gli strumenti: quando due soluzioni sono possibili, si sceglie quella che rispetta di più questi principi, anche se costa più lavoro.

Ogni principio riporta la sua origine. Quando il principio deriva da una decisione dell'autore, è marcato **Deciso**; quando è una proposta che nasce da questo lavoro di analisi, è marcato **Proposta**. Le conseguenze pratiche descrivono che cosa cambia nel comportamento del framework, nei file e nei messaggi all'utente.

Il pubblico di riferimento è il master che non ha mai usato un'intelligenza artificiale e non conosce i termini della programmazione. Il glossario in fondo è l'unico lessico del framework: elenca i termini interni, cioè le parole che i progettisti usano, e la parola che il master vede al loro posto. Gli altri documenti non ripetono un lessico proprio e rimandano qui. Nei messaggi all'utente non compare mai la colonna di sinistra.

## 1. Il master parla, il framework lavora

**Deciso.** L'utente parla in linguaggio naturale e non chiama mai una skill per nome. Il framework riconosce da solo che cosa il master vuole fare: preparare una sessione, creare un luogo, controllare una contraddizione, stampare le carte.

**Motivazione.** Il framework è pensato per chi vuole una campagna con un mondo molto dettagliato, senza dover imparare un sistema di comandi. Ogni comando da ricordare è un ostacolo, e ogni ostacolo tecnico tende a spingere il master verso l'abbandono o verso errori che non sa riconoscere.

**Conseguenze pratiche.**

- Non esistono comandi da ricordare. Le funzioni si attivano dal contenuto della richiesta, senza che il master debba indicarle per nome.
- I messaggi all'utente usano l'italiano comune e parlano di schede, sessioni, luoghi e personaggi. Non parlano di skill, commit, migrazioni o modelli (vedi il glossario).
- Le domande di chiarimento riguardano sempre il contenuto della campagna («il re è vivo o morto?»), mai la tecnica («vuoi usare Claude o Codex?»).
- Il master non sceglie mai uno strumento, un modello o un formato. Se una scelta tecnica è necessaria, la fa il framework e ne riferisce, se serve, in una frase.

## 2. Il risultato deve essere fatto bene senza che l'utente sappia come

**Deciso.** Il framework deve produrre risultati fatti bene anche quando chi lo usa non sa come vengono ottenuti. Questo obiettivo è esplicito nell'indice del progetto.

**Motivazione.** La qualità non può dipendere dalla competenza di chi usa il framework. Se il risultato buono richiede di sapere quale modello usare, quale controllo lanciare o quale ordine seguire, il framework ha fallito per il suo pubblico.

**Conseguenze pratiche.**

- La qualità è garantita dai processi del core (controlli, revisioni, verifiche automatiche), non dall'attenzione del master.
- Ogni risultato è accompagnato da una nota in linguaggio semplice: che cosa è cambiato, che cosa è stato verificato, che cosa resta aperto.
- Un risultato non verificato non viene presentato come verificato. Se una verifica non è riuscita, il framework lo dice con parole semplici e propone che cosa fare.

## 3. Una sola fonte di verità per ogni cosa

**Deciso** (indice, «YAGNI e una sola fonte di verità per ogni cosa»).

**Motivazione.** La continuità del mondo è il valore centrale di una campagna con molti documenti. Gli errori nascono quando lo stesso fatto è scritto in più punti e le copie divergono. Il sintomo più evidente è il lavoro doppio di aggiornamento dopo ogni cambiamento.

**Conseguenze pratiche.**

- Ogni informazione, non solo ogni fatto del mondo, ha un solo posto: le schede dedicate per identità e concetti, le sessioni per l'azione, i metadati per i pochi dati strutturati, lo storico git per le versioni, la configurazione per le scelte della campagna. Tutto il resto è derivato.
- Ogni soggetto importante (personaggio, luogo, oggetto, creatura, fazione) ha una sola scheda dedicata. Lì stanno identità, capacità e stato.
- Le sessioni e gli eventi descrivono che cosa succede e rimandano alla scheda. Non ridefiniscono l'identità di un soggetto.
- Gli indici e i derivati (mappa della trama, enciclopedia, viste per luogo, fogli di stampa, indice dei soggetti) sono **derivati**: si rigenerano dai documenti e non si modificano a mano.
- Un fatto senza fonte chiara non entra nel canone. Resta come lacuna nella sezione `## Da definire` della scheda, oppure come spunto in `Appunti/`.

## 4. Pubblico e riservato separati da una regola sola

**Deciso** (indice, «Note riservate e agenti»). Le informazioni riservate stanno in fondo alla stessa scheda, nel blocco `## Master`, e non escono mai verso chi non deve vederle. La forma esatta del blocco e le sue regole stanno in [Formato dei contenuti](Formato%20dei%20contenuti.md#13-parte-pubblica-e-blocco-riservato): qui si fissa soltanto chi può leggerlo.

**Motivazione.** Il master vuole preparare e consultare tutto in un unico documento, ma le uscite della campagna (enciclopedia, carte, stampe, prompt per immagini, testi per i giocatori) non devono mai contenere ciò che il master tiene riservato. Se la separazione dipende dalla memoria dell'agente, prima o poi un segreto esce. Deve valere per regola, e uno script la verifica.

**Conseguenze pratiche.**

- Gli agenti che lavorano sul canone vedono anche il blocco riservato, perché devono controllarlo: gli esecutori, l'audit di continuità, il dottore della campagna, la manutenzione della continuità, la portineria e gli handoff. La revisione indipendente di una bozza del canone, che controlla il canone, vede lo stesso blocco.
- Non lo ricevono mai: i revisori di testi destinati ai giocatori (enciclopedia, carte, riepiloghi), i fornitori di immagini, le ricerche web, i servizi di pubblicazione. Le uscite pubbliche leggono solo la parte pubblica.
- Un contenuto riservato diventa pubblico solo con un'azione esplicita del master, cioè lo spostamento del testo fuori dal blocco.
- Un rimando da un testo pubblico a una nota riservata punta alla nota con un'ancora (per esempio `scheda.md#master`), ma non ne riporta il contenuto.

## 5. Il framework e i contenuti dell'utente sono cose diverse

**Deciso.** I file del framework si sovrascrivono durante un aggiornamento. I contenuti dell'utente si toccano solo tramite migrazioni dichiarate e reversibili, mentre le personalizzazioni dell'utente non vengono mai toccate (indice, «Architettura», punto «Aggiornamenti come in Baltimora»).

**Motivazione.** Il master ha investito nella propria campagna. Un aggiornamento del framework non deve mai cancellare, spostare o alterare ciò che il master ha scritto, né le regole che ha aggiunto per il proprio modo di lavorare.

**Conseguenze pratiche.**

- Le cose appartengono a tre famiglie distinte: il pacchetto del framework (sovrascrivibile), i contenuti della campagna (dell'utente), le personalizzazioni e lo stato di lavoro (dell'utente, in un luogo separato).
- Nessun file del framework finisce dentro i contenuti della campagna senza una marcatura. Le istruzioni generate per gli agenti portano l'avvertenza «generato, non modificare» e vengono rigenerate.
- Un'eventuale migrazione è un passaggio dichiarato, con un'azione inversa. Se non è reversibile, il framework lo dice prima di applicarla.
- Le personalizzazioni vengono rispettate dal generatore delle istruzioni, ma restano nel file che l'utente possiede.

## 6. Il deterministico fa il conto, l'agente giudica

**Proposta** (dal piano di lavoro dell'indice). La parte meccanica (trovare tutte le menzioni di un soggetto, controllare i collegamenti, rigenerare gli indici) va su script deterministici. Lasciare tutto il lavoro all'agente è una causa probabile, ancora da verificare, dei fallimenti dei collegamenti e degli audit di continuità (indice, «Piano di lavoro»).

**Motivazione.** Un modello che cerca a memoria o scorre i file a campione non trova tutte le occorrenze. Un modello economico salta passaggi che un modello più grande non salta. Il conto esatto è un problema di precisione, non di intelligenza.

**Conseguenze pratiche.**

- Gli script producono elenchi completi: ogni occorrenza di un nome e dei suoi alias, ogni collegamento rotto, ogni blocco riservato mal chiuso, ogni dipendenza mancante.
- L'agente decide solo ciò che richiede senso: se una menzione è davvero quel soggetto, se un'affermazione contraddice un'altra, se una frase è un'ipotesi o un fatto.
- Ogni script ha casi di prova con l'esito atteso. Un cambiamento allo script si verifica con gli stessi casi.
- Ciò che non può essere verificato da uno script è dichiarato come **giudizio** dell'agente, non come controllo superato.

## 7. Il canone cambia solo dopo controlli e chiarimenti

**Deciso** (indice, «Revisione indipendente sempre»; indice, «Architettura»: le regole di lavoro sono il cablaggio interno del core).

**Motivazione.** Se queste regole sono solo ricordate all'agente, questo può dimenticarle. Un agente economico o un modello diverso da quello per cui sono state scritte le ignora più facilmente. La sequenza deve essere parte del processo, non un'abitudine.

**Conseguenze pratiche.**

- Ogni scrittura che tocca il canone passa per la sequenza di scrittura, definita in [Processi di core](Processi%20di%20core.md#cablaggio-di-scrittura): audit di continuità, bozza, revisione indipendente, scrittura, collegamenti, rigenerazione dei derivati, verifica automatica, versione salvata. Il master non deve chiederla.
- Se l'audit trova un conflitto che riguarda la modifica, il framework lo presenta al master prima di scrivere, e la scrittura si ferma. Un conflitto che non riguarda la modifica viene elencato a parte e non blocca il lavoro.
- Un controllo che non ha potuto girare non è mai dichiarato come riuscito.

## 8. Ipotesi, spunti e canone restano distinti

**Deciso** nella sostanza: uno spazio di spunti separato non è canone, e le ipotesi non diventano fatti senza indicazione.

**Motivazione.** Il master scrive sia ciò che è stabilito sia ciò che è ancora in sviluppo. Se il framework li mescola, produce un canone che nessuno ha deciso.

**Conseguenze pratiche.**

- Ogni elemento ha uno stato esplicito: **canone** (stabilito dal master), **spunto** o ipotesi (da sviluppare), **segreto** (solo nel blocco riservato), **bozza** (scritta dall'agente e non ancora confermata).
- L'agente non promuove uno spunto a canone. Lo fa solo se il master lo dice in modo chiaro.
- Una contraddizione fra uno spunto e il canone non è un errore: diventa un errore solo se un documento canonico presenta i due fatti come compatibili.

## 9. Nulla si perde in silenzio

**Proposta** (dal piano di lavoro dell'indice) per le versioni salvate invisibili e per il «torna a com'era» in linguaggio naturale (indice, «Progettare l'esperienza di chi non programma»).

**Motivazione.** Il master deve potersi permettere di sbagliare. Un framework che modifica i file senza lasciare traccia rende la campagna fragile e toglie fiducia.

**Conseguenze pratiche.**

- Ogni modifica completata e verificata crea una versione salvata (git, vedi [Architettura](Architettura.md#5-stato-versione-personalizzazioni)). Il master non deve sapere come si fa.
- Il master può dire «torna a come era prima della sessione» e il framework ripristina, mostrando che cosa cambierà.
- La cancellazione di contenuti richiede una conferma esplicita e mostra che cosa sarà perso.
- Un'operazione interrotta lascia i file come erano prima, oppure li lascia in uno stato dichiarato.

## 10. Ogni compito al modello adatto

**Deciso** (indice, «Più agenti, con ruoli distinti»; «Revisione indipendente sempre», «Codex è facoltativo»). L'agente principale, con un modello di alto livello, prende le decisioni e supervisiona. L'esecuzione (scrittura, lavoro in serie) va a modelli economici come Haiku o Luna, sotto la sua revisione. La revisione indipendente è obbligatoria.

**Motivazione.** Il costo di un lavoro in serie con un modello di alto livello è sproporzionato. Il valore sta nel giudizio, non nella quantità di scrittura. Osservazione dell'autore: i modelli differiscono per compito: alcuni rendono bene in revisione e nella generazione di immagini, altri meno nella scrittura di schede in serie.

**Conseguenze pratiche.**

- L'agente principale non esegue lavoro in serie. Lo delega, con istruzioni scritte, e poi controlla il risultato.
- La revisione indipendente è un passaggio distinto dalla preparazione: un agente prepara, un altro verifica, e il verificatore non vede ciò che il preparatore non deve vedere (vedi il principio 4).
- I compiti si assegnano per punti di forza dichiarati del modello, non solo per costo. L'assegnazione sta solo in [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md), con una colonna di ripiego.
- Codex è facoltativo: il framework funziona con Claude da solo, e Codex si aggiunge quando serve.
- Le istruzioni devono essere abbastanza esplicite da funzionare anche con il modello economico (principio 11).

## 11. Istruzioni esplicite, uguali per Claude e Codex

**Deciso** per le istruzioni esplicite (indice, «Skill robuste»). La generazione delle istruzioni da un unico modello è **Proposta**.

**Motivazione.** Un'istruzione che si basa su ciò che il modello «capisce da solo» produce risultati diversi da un modello all'altro e da una sessione all'altra. Il framework deve dare lo stesso esito indipendentemente dall'agente. Codex ha bisogno di istruzioni più esplicite di Claude (indice, «Skill robuste»).

**Conseguenze pratiche.**

- Ogni procedura è scritta come sequenza numerata, con condizioni di ingresso, condizioni di uscita e l'esito atteso di ogni passo.
- Nessun passo è implicito. Se un passaggio è obbligatorio, è scritto come obbligatorio, con il motivo.
- Le istruzioni per Claude e quelle per Codex non sono due testi scritti a mano: si generano da un unico modello (vedi [Architettura](Architettura.md#2-pacchetto-del-framework), sezione «Generazione delle istruzioni»).
- Se Codex è attivo, ogni caso di prova gira con entrambi gli agenti e l'esito è confrontato.

## 12. Il core non conosce né il mondo né il gioco

**Deciso.** Il core del framework non contiene nulla di un mondo specifico né di un sistema di gioco. Quando si citano, si citano come esempio. D&D 2024 è soltanto un adattatore di sistema di gioco (indice, «Obiettivo» e «Criteri di completamento»).

**Motivazione.** Il framework deve servire a qualunque campagna. Ogni riferimento a un mondo o a un sistema nel core lo renderebbe inutilizzabile altrove e costringerebbe chi usa un altro gioco a ignorare parti del framework.

**Conseguenze pratiche.**

- Nomi di categorie, cartelle, stili e regole vengono dalla configurazione della campagna, non dal core.
- Gli esempi nei documenti del framework sono dichiarati come esempi fittizi.
- Le regole di gioco (prove, CD, risorse, progressione) stanno solo nei moduli di sistema.

## 13. La campagna ha una forma propria e dichiarata

**Proposta**, derivata dall'indice («Configurazione della campagna»).

**Motivazione.** Campagne diverse hanno esigenze diverse: un mondo a cascata e uno a cartelle piatte, una lingua diversa, un registro narrativo diverso, un sistema diverso. Il framework non può presumere una forma fissa.

**Conseguenze pratiche.**

- La forma della campagna (lingua, registro, sistema, categorie e struttura delle cartelle, stili, moduli) è dichiarata in un file di configurazione, letto da tutto il framework.
- Il framework non presume aree fisse: le aree sono quelle che la configurazione descrive.
- Due campagne possono avere cartelle e categorie diverse senza che il framework cambi.

## 14. Il lavoro dichiara ciò che non sa

**Proposta**, derivata dalla regola che un elemento ancora ignoto resta aperto e dalle skill di libreria, che chiedono di segnalare le lacune.

**Motivazione.** Un framework che riempie le lacune con invenzioni plausibili rovina la campagna in modo silenzioso. La lacuna va dichiarata, non coperta.

**Conseguenze pratiche.**

- Una lacuna va scritta nella sezione `## Da definire` della scheda interessata, come prevede [Formato dei contenuti](Formato%20dei%20contenuti.md).
- L'agente non inventa fatti su elementi che il master non ha chiesto, né segreti, eventi passati, relazioni con altri personaggi, date, effetti o regole di gioco (statistiche, prezzi, scorte, bottino).
- Quando la richiesta stessa ha bisogno di un personaggio (l'avversario di uno scontro richiesto, chi gestisce un luogo o un servizio richiesto), con la fantasia sbloccata (principio 17) l'agente lo crea con proposte brevi coerenti con la campagna, lo dichiara al master e cambia le proposte su richiesta; senza permesso il personaggio resta senza nome e senza scheda, e la scena lo chiama per ruolo.
- Le domande al master sono limitate alle lacune che non si possono risolvere dalle fonti. Una domanda è una decisione canonica, non una preferenza redazionale.

## 15. Le dipendenze fra eventi sono dichiarate

**Proposta**: ogni sessione o attività di trama dichiara il prerequisito, cioè la sessione o la sezione che deve essere giocata prima, nel campo `depends_on` dei suoi metadati (l'unico posto in cui sta). Il meccanismo vale per ogni struttura a sequenza (campagne a capitoli, a missioni, a stagioni) ed è verificabile.

**Motivazione.** Un ordine implicito obbliga il master a ricordare la struttura. Una dipendenza dichiarata la rende leggibile e la fa verificare.

**Conseguenze pratiche.**

- Ogni attività di trama dichiara i prerequisiti. Una attività senza prerequisiti lo dichiara esplicitamente.
- La mappa della trama è un indice derivato dalle dichiarazioni. Quando la struttura cambia, la mappa si rigenera.
- Uno script segnala i riferimenti a documenti inesistenti e i cicli.

## 16. YAGNI: solo ciò che serve oggi

**Deciso** (indice).

**Motivazione.** Un framework per chi non programma deve restare piccolo e comprensibile. Ogni cartella, campo o modulo previsto «per quando servirà» è una cosa in più da spiegare, mantenere e migrare, e spesso il bisogno reale arriva in una forma diversa da quella immaginata.

**Conseguenze pratiche.**

- Una funzione, un campo di configurazione o una cartella entra nel framework solo quando una campagna reale ne ha bisogno.
- Le estensioni immaginate restano nelle questioni aperte o in un elenco «fuori dalla prima versione», non nella struttura.
- Fra due soluzioni che risolvono lo stesso problema si sceglie quella con meno parti.
- YAGNI non giustifica scorciatoie sulla robustezza: verifiche, casi di prova e separazione pubblico/riservato servono già oggi.

## 17. Il framework non inventa: la fantasia è un permesso del master

**Deciso** (2026-11-10, scelta dell'autore; vedi l'indice, «Fantasia del modello, bloccata per default»).

**Motivazione.** Un framework che riempie le lacune con dettagli plausibili rovina il canone in silenzio. Il master non deve scoprire dopo che un nome, un segreto o un prezzo l'ha deciso un modello.

**Conseguenze pratiche.**

- Per default l'agente non crea nulla che le fonti non danno. La creatività è un permesso che il master concede, mai una presunzione del framework.
- Il permesso si dà in una richiesta («inventa tu»), oppure con la configurazione (`allow_model_imagination`), oppure rispondendo alla domanda che il framework pone quando il valore non è ancora deciso.
- Anche con il permesso il canone resta intoccabile: un'invenzione che contraddice il canone è un errore come un altro. Segreti e contenuti riservati restano nel blocco del master, e il master sa sempre che cosa è stato inventato.
- Il permesso non vale mai per la cronaca dopo la sessione né per la trascrizione fedele di un documento: lì si registra solo ciò che è stato detto o scritto.
- Senza permesso non si scrivono nemmeno le proposte. Una lacuna di una scheda resta «Da definire», e un personaggio richiesto dalla scena ma senza nome resta senza nome e senza scheda, chiamato per ruolo. Il messaggio dice che il master può chiedere di inventarli.

## Glossario

I termini della colonna «Termine interno» sono usati nei documenti di progetto e negli script, e nelle prose della specifica compaiono con il nome indicato in quella colonna. Il master non li vede mai: nei messaggi e nelle schermate compare solo la colonna «Cosa vede il master». Le voci «Cosa vede il master» sono le uniche parole mostrate all'utente.

| Termine interno | Cosa vede il master | Significato |
|---|---|---|
| Skill | Il nome dell'operazione, o nulla | Un'istruzione specializzata che l'agente segue per un tipo di lavoro |
| Skill di core (processo) | Il nome del processo (per esempio «Prepara la sessione») | Processo che il master vive, chiamato dal framework in base alla richiesta |
| Skill di libreria | «Strumento» o nulla | Operazione specialistica richiamata dal core |
| Modulo | «Impostazione» o «Stile» | Estensione opzionale attivata dalla configurazione |
| Adattatore di sistema | «Regole del gioco» | Modulo che traduce le regole di un gioco in ciò che il framework usa |
| Profilo di stile | «Stile delle immagini» | Insieme di indicazioni visive per carte, ritratti e mappe |
| Core | Non visibile | Insieme dei processi e delle regole fisse del framework |
| Libreria | Non visibile | Insieme degli strumenti specialistici |
| Agente principale | «L'assistente» | Agente di alto livello che decide e supervisiona |
| Portineria | «L'assistente» | Agente principale nella prima versione, che riceve le richieste, delega ai sub-agent e conserva i riassunti |
| Sub-agent | «Un revisore» o «un assistente» | Agente delegato per un compito distinto, spesso di revisione |
| Revisione indipendente | «Controllo di un secondo assistente» | Verifica fatta da un agente che non ha scritto la bozza |
| Modello economico | Non visibile | Modello meno costoso (per esempio Haiku o Luna) usato per l'esecuzione |
| Codex | Non visibile | Altro agente di programmazione, facoltativo, usato come esecutore o revisore |
| Orchestrazione | Non visibile | Insieme di regole con cui l'agente principale distribuisce il lavoro |
| ImageGen | «Generatore di immagini» | Strumento di generazione immagini usato dall'agente |
| Prompt | «Descrizione per l'immagine» | Istruzione scritta per un generatore di immagini |
| MCP | Non visibile | Collegamento con un'applicazione esterna (per esempio il programma di grafica) |
| Repository | «La campagna» | Cartella che contiene la campagna e il suo storico |
| Commit | «Versione salvata» | Stato dei file registrato nello storico, a cui si può tornare |
| Ripristino | «Torna a com'era» | Riporto di una o più parti della campagna a una versione salvata |
| Migrazione | «Aggiornamento della struttura» | Passaggio dichiarato che sposta o trasforma i contenuti dopo un aggiornamento |
| Versione del framework | «Versione» (solo in una nota) | Numero che identifica il pacchetto del framework con cui la campagna è stata creata o aggiornata |
| Aggiornamento | «Aggiornamento disponibile» | Installazione di una versione più recente del framework |
| Manifest | Non visibile | File (`manifest.yaml`) che dichiara il contenuto e la versione di un pacchetto |
| Template | Non visibile | Modello da cui si generano file, per esempio le istruzioni degli agenti |
| Configurazione | «Impostazioni della campagna» | File `campaign.yaml`, che descrive la forma della campagna |
| Personalizzazioni | «Le tue regole» | File `.campaign/customizations.md`, in cui il master aggiunge regole proprie, mai sovrascritto |
| Hook | «Controllo automatico» | Azione che parte da sola in un momento definito, per esempio all'avvio |
| Script deterministico | Non visibile | Programma che produce sempre lo stesso risultato dagli stessi file |
| Caso di prova (test) | Non visibile | Esempio con esito atteso, usato per verificare un cambiamento |
| Audit di continuità (`continuity-audit`) | «Controllo di coerenza» | Verifica che i documenti non si contraddicano |
| Collegamenti (`linker`) | «Collegamenti» | Operazione che inserisce i rimandi fra le schede |
| Ricerca nel canone (`canon-research`) | «Che cosa dice la campagna» | Ricerca di che cosa è stabilito su un soggetto, con le fonti |
| Tracker degli scontri (`combat-tracker`) | «Scontro» | Conto di iniziativa, punti ferita e turni durante un combattimento |
| Registro di sessione (`session-log`) | «Registro della partita» | Note di che cosa accade al tavolo; non è canone |
| Indice derivato | «Mappa» o «Enciclopedia» | Documento generato dai contenuti, da non modificare a mano |
| Indice dei soggetti | Non visibile | Derivato (`.campaign/cache/subjects.json`) dagli alias delle schede |
| Alias (`aliases`) | «Altri nomi» | Forme alternative del nome di un soggetto |
| Mappa della trama | «Mappa della trama» | Indice grafico delle sessioni e delle loro dipendenze |
| Metadati | «Dati della scheda» (solo nei documenti) | Blocco di dati in testa a un file Markdown (`id`, `location`, `depends_on`, `print`, `merged_ids`, `aliases`, `template`) |
| Markdown | «Scheda» o «documento» | Formato dei testi della campagna |
| Blocco master | «Note del master» | Parte riservata in fondo a una scheda |
| Ancora | Non visibile (il rimando funziona) | Punto preciso di un documento a cui si rimanda |
| Stato di lavoro | «Appunti della partita» | Dati temporanei di una sessione live o di uno scontro, in `.campaign/state/`: separati dal canone e cancellabili senza effetti sul mondo |
| Sessione live | «Partita in corso» | Gestione della partita durante il gioco |
| Sessione di lavoro | «Conversazione» | Una conversazione con l'agente, che il framework può riprendere o sostituire |
| Argomento | «Argomento» | Filone di lavoro (una scena, un luogo, un arco in preparazione) che il framework riconosce e riprende, in `.campaign/state/topics/` |
| Handoff | «Riepilogo per riprendere» | Nota scritta prima di un riassunto automatico o di un cambio di sessione, da cui il lavoro riprende |
| Sessione (documento) | «Sessione» | Documento di una giocata o di un'attività di trama, in `Trama/` |
| Stato di stampa (metadato `print`) | «Da stampare», «Stampata», «Da ristampare» | Stato fisico della carta di un oggetto (`to-print`, `printed`, `reprint`) |
| Tela libera | «Tela libera» | Area libera del master screen, senza struttura fissa |
| Master screen | «Schermo del master» | Strumento grafico locale del master: chat, consultazione, sessione live, musica, stampa |
| PSD | «File di lavoro del disegno» | File a livelli per la modifica di una carta |
| PNG | «Immagine» | Formato di immagine finale |
| JSON, YAML | «Dati» | Formati di file per i dati strutturati |

## Questioni aperte

- La forma della campagna può essere spezzata in più file (una parte per il mondo, una per le regole)? Il principio 13 presume un file solo.
- Il principio 15 generalizza le dipendenze fra sessioni a ogni struttura a sequenza. Va verificato con almeno due tipi di campagna diversi che il meccanismo regga.
- Fino a dove un principio può essere sacrificato per la semplicità della prima versione (per esempio il blocco riservato o la versione salvata invisibile)? La prima versione va definita come insieme minimo di principi non negoziabili.
