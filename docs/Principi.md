# Principi di progetto

**Stato:** Bozza di progetto. Riscritto dopo la [Riprogettazione](Riprogettazione.md) (2026-11-11).
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

Questo documento fissa i principi che guidano ogni scelta del framework e il glossario dei termini tecnici. I principi valgono per il core, per le skill di libreria, per i moduli e per gli strumenti: quando due soluzioni sono possibili, si sceglie quella che rispetta di più questi principi, anche se costa più lavoro.

Ogni principio riporta la sua origine:

- **Deciso**: deriva da una decisione dell'autore, nell'indice del progetto o nella [Riprogettazione](Riprogettazione.md). Le decisioni della Riprogettazione portano la data 2026-11-11.
- **Implementato in 0.30.0**: è un fatto realizzato nella versione 0.30.0 del framework.
- **Proposta**: è una proposta che nasce da questo lavoro di analisi e non è ancora approvata.

Dove un principio precedente è superato dalla Riprogettazione, il testo è riscritto e la fonte cita la decisione che lo sostituisce, per esempio «(Riprogettazione, decisione 5)».

Il pubblico di riferimento è il master che non ha mai usato un'intelligenza artificiale e non conosce i termini della programmazione. Il glossario in fondo è l'unico lessico del framework: elenca i termini interni, cioè le parole che i progettisti usano, e la parola che il master vede al loro posto. Gli altri documenti non ripetono un lessico proprio e rimandano qui. Nei messaggi all'utente non compare mai la colonna di sinistra.

## 1. Il master parla, il framework lavora

**Deciso** (indice, «Obiettivo»; Riprogettazione, decisione 3, 2026-11-11).

**Motivazione.** Il framework è pensato per chi vuole una campagna con un mondo molto dettagliato, senza dover imparare un sistema di comandi. Ogni comando da ricordare è un ostacolo, e ogni ostacolo tecnico tende a spingere il master verso l'abbandono o verso errori che non sa riconoscere.

**Conseguenze pratiche.**

- Non esistono comandi da ricordare. L'autore riconosce che cosa vuole il master dal contenuto della richiesta: preparare una sessione, scrivere un luogo o un personaggio, rispondere a una domanda sul mondo, portare dentro materiale esistente, tornare a una versione precedente.
- I messaggi all'utente usano l'italiano comune e parlano di schede, sessioni, luoghi e personaggi. Non parlano di skill, motore, commit, migrazioni o modelli (vedi il glossario).
- Le domande di chiarimento riguardano sempre il contenuto della campagna («il re è vivo o morto?»), mai la tecnica («vuoi usare Claude o Codex?»).
- Il master non sceglie mai uno strumento, un modello, un livello di costo o un formato. Le scelte tecniche le fa il framework e ne riferisce, se serve, in una frase (Riprogettazione, decisione 3).
- Il framework decide molti dettagli da solo e li dichiara dopo (principio 17). Le domande al master restano per le decisioni canoniche che il framework non deve prendere da solo (**Proposta**).

## 2. Il risultato deve essere fatto bene senza che l'utente sappia come

**Deciso** (indice, «Obiettivo»).

**Motivazione.** La qualità non può dipendere dalla competenza di chi usa il framework. Se il risultato buono richiede di sapere quale modello usare, quale controllo lanciare o quale ordine seguire, il framework ha fallito per il suo pubblico.

**Conseguenze pratiche.**

- La qualità è garantita dal motore, che esegue sempre i controlli deterministici, e, per i lotti che aggiungono fatti al canone, dalla revisione di un modello distinto (Riprogettazione, decisione 5; **Implementato in 0.30.0**).
- Ogni risultato è accompagnato da una nota in linguaggio semplice: che cosa è cambiato, che cosa è stato verificato, che cosa resta aperto (**Proposta** per il formato della nota).
- Un risultato non verificato non viene presentato come verificato. Se una verifica non è riuscita, il framework lo dice con parole semplici e propone che cosa fare.

## 3. Una sola fonte di verità per ogni cosa

**Deciso** (indice, «YAGNI e una sola fonte di verità per ogni cosa»). Il documento del seme del mondo è deciso nella Riprogettazione, sezione 4 (**Implementato in 0.30.0**).

**Motivazione.** La continuità del mondo è il valore centrale di una campagna con molti documenti. Gli errori nascono quando lo stesso fatto è scritto in più punti e le copie divergono. Il sintomo più evidente è il lavoro doppio di aggiornamento dopo ogni cambiamento.

**Conseguenze pratiche.**

- Ogni informazione, non solo ogni fatto del mondo, ha un solo posto: le schede dedicate per identità e concetti, le sessioni per l'azione, i metadati per i dati strutturati, lo storico git per le versioni, la configurazione e il documento del seme per le scelte della campagna. Tutto il resto è derivato.
- Ogni soggetto importante (personaggio, luogo, oggetto, creatura, fazione) ha una sola scheda dedicata, con il suo tipo dichiarato nei metadati (`kind`). Lì stanno identità, capacità e stato (**Implementato in 0.30.0**).
- Le sessioni e gli eventi descrivono che cosa succede e rimandano alla scheda. Non ridefiniscono l'identità di un soggetto.
- Il documento del seme del mondo sostituisce la frase unica di descrizione in `campaign.yaml`. Contiene genere, temi, conflitti, fazioni, culture, convenzioni dei nomi, livello di potere e cose da evitare, e cresce con il mondo (Riprogettazione, sezione 4; **Implementato in 0.30.0**).
- Gli indici e i derivati sono **derivati**: si rigenerano dai documenti e non si modificano a mano. Sono derivati l'indice dei soggetti, l'indice del mondo, il file principale di ogni sessione e la mappa della trama (**Implementato in 0.30.0** per i primi tre). L'enciclopedia, i fogli di stampa e le viste per luogo sono **Proposta**.
- Un fatto inventato dal framework entra nel canone solo come documento generato, con la sua provenienza dichiarata, e il master ne è avvisato (Riprogettazione, decisioni 7 e 12; vedi principio 14). Un fatto generato non viene mai presentato come detto dal master.
- Gli abbozzi (righe di un piano non ancora espanse) sono documenti del canone marcati come tali, non appunti separati (Riprogettazione, decisione 13; vedi principio 8). Gli appunti fuori canone, in una cartella `Appunti/`, restano **Proposta**.

## 4. Pubblico e riservato separati da una regola sola

**Deciso** (indice, «Note riservate e agenti»). Le informazioni riservate stanno in fondo alla stessa scheda, nel blocco `## Master`, e non escono mai verso chi non deve vederle. La forma esatta del blocco e le sue regole stanno in [Formato dei contenuti](Formato%20dei%20contenuti.md#13-parte-pubblica-e-blocco-riservato): qui si fissa soltanto chi può leggerlo.

**Motivazione.** Il master vuole preparare e consultare tutto in un unico documento, ma le uscite della campagna (enciclopedia, carte, stampe, prompt per immagini, testi per i giocatori) non devono mai contenere ciò che il master tiene riservato. Se la separazione dipende dalla memoria dell'agente, prima o poi un segreto esce. Deve valere per regola, e uno script la verifica.

**Conseguenze pratiche.**

- Gli agenti che lavorano sul canone vedono anche il blocco riservato, perché devono controllarlo: l'autore, il revisore di lotto (che giudica i segreti finiti nel testo pubblico) e, quando è richiesto, l'audit di continuità (Riprogettazione, sezione 1).
- Per gli esecutori economici che scrivono le schede, la regola non è ancora decisa: vedi Questioni aperte.
- Non lo ricevono mai: i revisori di testi destinati ai giocatori (enciclopedia, carte, riepiloghi), i fornitori di immagini, le ricerche web (Riprogettazione, decisione 10: una ricerca non riceve mai il blocco riservato) e i servizi di pubblicazione. Le uscite pubbliche leggono solo la parte pubblica.
- Un contenuto riservato diventa pubblico solo con un'azione esplicita del master, cioè lo spostamento del testo fuori dal blocco.
- Un rimando da un testo pubblico a una nota riservata punta alla nota con un'ancora (per esempio `scheda.md#master`), ma non ne riporta il contenuto.
- Il motore verifica il blocco riservato in ogni scrittura: un blocco non chiuso o un segreto nella parte pubblica segnalato dal revisore blocca la scrittura (**Implementato in 0.30.0** per il controllo del blocco; il controllo dei segreti nel testo pubblico è affidato al revisore di lotto, Riprogettazione, sezione 1).

## 5. Il framework e i contenuti dell'utente sono cose diverse

**Deciso** (indice, «Architettura», punto «Aggiornamenti come in Baltimora»). Le migrazioni dichiarate e reversibili sono decise dalla Riprogettazione, decisione 6.

**Motivazione.** Il master ha investito nella propria campagna. Un aggiornamento del framework non deve mai cancellare, spostare o alterare ciò che il master ha scritto, né le regole che ha aggiunto per il proprio modo di lavorare.

**Conseguenze pratiche.**

- Le cose appartengono a tre famiglie distinte: il pacchetto del framework (sovrascrivibile), i contenuti della campagna (dell'utente), le personalizzazioni e lo stato di lavoro (dell'utente, in un luogo separato).
- Nessun file del framework finisce dentro i contenuti della campagna senza una marcatura. Le istruzioni generate per gli agenti, se il framework le produce, devono portare l'avvertenza «generato, non modificare» (**Proposta**: vedi Questioni aperte in [Architettura](Architettura.md#questioni-aperte)).
- Un'eventuale migrazione è un passaggio dichiarato, con un'azione inversa. La migrazione `world-graph-v1` aggiunge a ogni documento tipo e provenienza, crea il seme dalla vecchia descrizione, toglie la chiave `allow_model_imagination`, non riscrive la prosa, è riprendibile e si annulla con git (Riprogettazione, decisione 6 e sezione 10; **Implementato in 0.30.0**).
- Le modifiche fatte a mano dal master in un documento generato sono rispettate. Il motore salva le modifiche come versione a parte e rifiuta di sovrascrivere un file del lotto modificato a mano: l'autore lo lascia com'è e avvisa il master in una frase (Riprogettazione, decisione 12; **Implementato in 0.30.0**).
- Le personalizzazioni vengono rispettate dal generatore delle istruzioni, ma restano nel file che l'utente possiede (**Proposta**).

## 6. Il deterministico fa il conto, l'agente giudica

**Deciso, 2026-11-11** (Riprogettazione, decisioni 5 e 14; sezione 2: «Un solo programma a riga di comando sostituisce il cablaggio di scrittura»). **Implementato in 0.30.0** nel motore `engine.mjs`.

**Motivazione.** Un modello che cerca a memoria o scorre i file a campione non trova tutte le occorrenze. Un modello economico salta passaggi che un modello più grande non salta. Il conto esatto è un problema di precisione, non di intelligenza.

**Conseguenze pratiche.**

- Il motore produce elenchi completi: ogni occorrenza di un nome e dei suoi alias, ogni collegamento rotto, ogni blocco riservato mal chiuso, ogni dipendenza mancante, ogni riferimento a un soggetto inesistente, ogni data impossibile, ogni errore di schema dell'adattatore e ogni collocazione geografica (**Implementato in 0.30.0**).
- Il motore non usa alcun modello. I controlli sono sempre eseguiti, anche quando un lotto non aggiunge fatti (**Implementato in 0.30.0**).
- Un errore nuovo blocca la scrittura; gli errori già presenti in altre parti della campagna non la bloccano (**Implementato in 0.30.0**).
- Gli errori meccanici tornano all'autore prima di ogni revisione. Il revisore non controlla il formato (Riprogettazione, sezione 2).
- L'agente decide solo ciò che richiede senso: se una menzione è davvero quel soggetto, se un'affermazione contraddice un'altra, se una frase è un'ipotesi o un fatto.
- Ogni script ha casi di prova con l'esito atteso, e un cambiamento allo script si verifica con gli stessi casi (**Proposta**: i casi di prova esistono nel codice, ma questo requisito non è un fatto confermato dalla Riprogettazione).
- Ciò che non può essere verificato da uno script è dichiarato come **giudizio** dell'agente o del revisore, non come controllo superato.

## 7. Il canone cambia solo dopo controlli e, per i fatti nuovi, una revisione

**Deciso, 2026-11-11** (Riprogettazione, decisione 5, che supera «Revisione indipendente sempre» dell'indice; sezione 9: l'audit di continuità esce dal percorso di scrittura). **Implementato in 0.30.0.**

**Motivazione.** Se queste regole sono solo ricordate all'agente, questo può dimenticarle. Un agente economico o un modello diverso da quello per cui sono state scritte le ignora più facilmente. La sequenza deve essere parte del motore, non un'abitudine.

**Conseguenze pratiche.**

- Ogni scrittura che tocca il canone passa dal motore: `check` controlla senza scrivere, `commit` valida, collega, aggiorna gli indici e salva la versione in un'unica transazione. Il master non deve chiederlo, e l'agente non deve ricordare i passi. Il cablaggio di scrittura come skill è superato (Riprogettazione, sezione 9; [Processi di core](Processi%20di%20core.md)).
- La revisione di un modello distinto avviene solo sui lotti che aggiungono fatti al canone. Un lotto che sposta soltanto documenti o cambia solo i collegamenti non la richiede (Riprogettazione, decisioni 5 e 14).
- Il revisore giudica solo ciò che uno script non può giudicare: contraddizioni di senso con il canone giocato e con il seme, segreti nel testo pubblico, invenzioni presentate come citazioni di una fonte (Riprogettazione, sezione 1).
- L'audit di continuità non fa più parte della scrittura. Resta una verifica su richiesta, con i suoi agenti di estrazione e di giudizio (Riprogettazione, decisione 5 e sezione 9).
- Se un controllo trova un conflitto che riguarda la modifica, il framework lo presenta al master prima di scrivere, e la scrittura si ferma. Un conflitto che non riguarda la modifica viene elencato a parte e non blocca il lavoro (**Proposta**: il motore già blocca solo gli errori nuovi; la presentazione al master è da definire).
- Un controllo che non ha potuto girare non è mai dichiarato come riuscito (**Proposta**).

## 8. Ipotesi, abbozzi e canone restano distinti

**Deciso** nella sostanza: uno spazio di spunti separato non è canone, e le ipotesi non diventano fatti senza indicazione (decisione dell'autore, già nella versione precedente di questo documento). **Superata dalla Riprogettazione (2026-11-11)** in un punto: gli spunti non stanno più in `Appunti/` ma gli abbozzi entrano nel canone come documenti marcati, ogni riga della scaletta che non viene espansa subito (Riprogettazione, decisione 13; sezione 5).

**Motivazione.** Il master scrive sia ciò che è stabilito sia ciò che è ancora in sviluppo. Se il framework mescola i due, produce un canone che nessuno ha deciso. Un abbozzo è un'eccezione deliberata: serve a tenere un mondo ampio senza costi, e il dettaglio arriva dove si gioca.

**Conseguenze pratiche.**

- Un abbozzo è un documento valido del canone, con nome, tipo, legami e una frase, marcato con `sketch: true` (**Implementato in 0.30.0**). Non è una scheda completa.
- Un abbozzo viene espanso quando il master lo nomina o quando una sessione lo usa (Riprogettazione, sezione 5).
- Ogni elemento ha uno stato esplicito: **canone** (stabilito dal master), **abbozzo** (creato dal framework, da espandere), **segreto** (solo nel blocco riservato), **bozza** (scritta dall'agente e non ancora confermata).
- L'agente non promuove un abbozzo o una bozza a canone stabilito. Lo fa solo se il master lo dice in modo chiaro (**Proposta**).
- Una contraddizione fra un abbozzo e il canone è un errore come un altro, da segnalare al revisore di lotto (**Proposta**).

## 9. Nulla si perde in silenzio

**Proposta** per il ripristino in linguaggio naturale e per la cancellazione con conferma. **Implementato in 0.30.0** per le versioni salvate e per la transazione di scrittura. Le versioni salvate con git sono decise nell'indice («Git dalla prima creazione»).

**Motivazione.** Il master deve potersi permettere di sbagliare. Un framework che modifica i file senza lasciare traccia rende la campagna fragile e toglie fiducia.

**Conseguenze pratiche.**

- Ogni scrittura completata e verificata crea una versione salvata: il motore ne salva una per `commit` (git, vedi [Architettura](Architettura.md#5-stato-versione-personalizzazioni)). Il master non deve sapere come si fa.
- Un errore durante `commit` non scrive nulla. Il lavoro si ferma prima della scrittura, e la campagna resta com'era (**Implementato in 0.30.0**).
- Il master può dire «torna a come era prima della sessione» e il framework ripristina, mostrando che cosa cambierà (**Proposta**).
- La cancellazione di contenuti richiede una conferma esplicita e mostra che cosa sarà perso (**Proposta**).

## 10. Ogni compito al modello adatto

**Deciso, 2026-11-11** (Riprogettazione, decisioni 3, 4, 5 e 16). Supera «Revisione indipendente sempre» e modifica «Più agenti, con ruoli distinti» dell'indice.

**Motivazione.** Il costo di un lavoro in serie con un modello di alto livello è sproporzionato. Il valore sta nel giudizio e nella scrittura creativa, non nella quantità di scrittura meccanica. Osservazione dell'autore: i modelli differiscono per compito. Dopo la Riprogettazione il framework usa Haiku come modello economico; Luna non è più usata dal framework, e l'osservazione resta come informazione sui modelli.

**Conseguenze pratiche.**

- L'autore, con il modello di alto livello, parla con il master e scrive in conversazione mondo, schede e scene. La scrittura creativa spetta a Claude (decisione 4; **Implementato in 0.30.0**: l'autore scrive da sé, senza un sub-agent che esegue il processo al suo posto).
- Gli esecutori economici ricevono un ordine preciso e delimitato: espandere una riga della scaletta in una scheda, estrarre fatti da un documento, giudicare un link ambiguo. Lavorano in parallelo su file diversi (Riprogettazione, sezione 1; **Implementato in 0.30.0** per l'espansione delle schede).
- La delega la decide il framework in base alla dimensione del lavoro, senza una soglia fissa nella specifica (decisione 16). Il valore di partenza (fino a tre schede scritte dall'autore, poi un esecutore per scheda) è implementato ma va tarato con il testbench.
- La revisione di un modello distinto è un passaggio distinto dalla preparazione, e avviene solo per i lotti che aggiungono fatti (decisione 5).
- I compiti si assegnano per punti di forza dichiarati del modello, non solo per costo. L'assegnazione sta in [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md) (**Proposta**).
- Codex esce dal framework e al più resta un fornitore di immagini facoltativo, senza istruzioni né plugin dedicati (decisioni 4 e 11).

## 11. Istruzioni esplicite per gli esecutori economici

**Deciso** per le istruzioni esplicite (indice, «Skill robuste», modificato dalle decisioni 4 e 11 della Riprogettazione: Codex esce dal framework). La generazione delle istruzioni da un unico modello per Claude e Codex è **superata** dalla Riprogettazione, decisione 11.

**Motivazione.** Un'istruzione che si basa su ciò che il modello «capisce da solo» produce risultati diversi da una sessione all'altra. Il framework deve dare lo stesso esito indipendentemente dall'agente, e in particolare deve funzionare con un modello economico che esegue un ordine preciso.

**Conseguenze pratiche.**

- Per i processi, le skill descrivono obiettivo, vincoli e contratto di formato, non procedure passo per passo (Riprogettazione, sezione 8).
- Gli ordini agli esecutori economici sono scritti in modo esplicito: file in ingresso, file in uscita, formato dell'esito, e l'indicazione di che cosa non decidere. Nessun passo è implicito (**Proposta** nella forma dettagliata, già in uso per l'espansione delle schede).
- Quando un passaggio è obbligatorio, è scritto come obbligatorio, con il motivo.
- Non ci sono più istruzioni separate per Codex. Ogni caso di prova gira solo con Claude: il testbench misura solo Claude (Riprogettazione, sezione 11).

## 12. Il core non conosce né il mondo né il gioco

**Deciso** (indice, «Obiettivo» e «Criteri di completamento»; Riprogettazione, decisione 10 e sezione 7). **Implementato in 0.30.0**: l'adattatore è uno schema, e l'aritmetica di D&D 2024 sta nel suo modulo.

**Motivazione.** Il framework deve servire a qualunque campagna. Ogni riferimento a un mondo o a un sistema nel core lo renderebbe inutilizzabile altrove e costringerebbe chi usa un altro gioco a ignorare parti del framework.

**Conseguenze pratiche.**

- Nomi di categorie, cartelle, stili e regole vengono dalla configurazione della campagna, non dal core.
- Gli esempi nei documenti del framework sono dichiarati come esempi fittizi.
- L'adattatore descrive la forma delle schede del sistema (campi obbligatori e facoltativi, scala delle difficoltà, risorse, condizioni) e l'aritmetica del sistema, per esempio i modificatori dei punteggi. Non contiene le tabelle delle regole del gioco (Riprogettazione, decisione 10 e sezione 7).
- Statistiche, difficoltà, prezzi ed effetti si scrivono con la conoscenza del modello o con una sua ricerca, e lo schema li valida: una ricerca non riceve mai il blocco riservato (Riprogettazione, decisione 10).
- Senza adattatore, le difficoltà e i valori restano in parole, come prima.

## 13. La campagna ha una forma propria e dichiarata

**Proposta**, derivata dall'indice («Configurazione della campagna»). Le parti del documento di configurazione marcate sotto sono **Implementato in 0.30.0** o **Deciso, 2026-11-11**.

**Motivazione.** Campagne diverse hanno esigenze diverse: un mondo a cascata e uno a cartelle piatte, una lingua diversa, un registro narrativo diverso, un sistema diverso. Il framework non può presumere una forma fissa.

**Conseguenze pratiche.**

- La forma della campagna (lingua, registro, sistema, categorie e struttura delle cartelle, stili, moduli) è dichiarata in un file di configurazione, letto da tutto il framework.
- Il seme del mondo è un documento a sé, nella radice della campagna, indicato da `campaign.seed` (**Implementato in 0.30.0**). Non è più una frase in `campaign.yaml`.
- La chiave `allow_model_imagination` non è più usata: il framework la accetta e la ignora, e la migrazione la toglie (**Implementato in 0.30.0**; Riprogettazione, decisione 7).
- Il framework non presume aree fisse: le aree sono quelle che la configurazione descrive.
- Due campagne possono avere cartelle e categorie diverse senza che il framework cambi.

## 14. Il lavoro dichiara le proprie invenzioni e le proprie lacune

**Deciso, 2026-11-11** (Riprogettazione, decisione 7, che supera «Fantasia del modello, bloccata per default» dell'indice; decisione 6 per la provenienza; decisione 13 per gli abbozzi). **Implementato in 0.30.0** per la provenienza e per la cronaca che riporta solo ciò che il master racconta.

**Motivazione.** Un framework che inventa senza dirlo rovina il canone in silenzio. Un framework che inventa e dichiara lascia al master la decisione finale, e può correggere ciò che è stato inventato parlando (decisione 3).

**Conseguenze pratiche.**

- Il framework inventa ciò che le fonti non danno: nomi, luoghi, legami, eventi passati, segreti, statistiche, prezzi, bottino (Riprogettazione, decisione 7).
- Ogni documento porta la sua provenienza: «detto dal master», «giocato al tavolo» o «generato dal framework». Un documento generato si può rigenerare o cambiare liberamente, e il master viene avvisato in una frase di che cosa è nuovo (decisioni 6 e 7; **Implementato in 0.30.0** per la provenienza).
- Un documento generato che il master corregge a mano smette di essere rigenerabile: il framework rispetta le modifiche che non ha fatto lui (decisione 6; principio 5).
- Un'invenzione non si presenta mai come citazione di una fonte, e un segreto inventato sta solo nel blocco riservato (decisione 6).
- Un personaggio richiesto dalla scena e non ancora nominato viene creato dal framework e dichiarato al master, che può cambiarlo parlando (decisioni 3 e 7).
- Il permesso non vale mai per la cronaca dopo la sessione né per la trascrizione fedele di un documento importato: la cronaca riporta solo ciò che il master racconta, e in essa il motore applica i fatti dichiarati e propone soltanto le invenzioni (decisione 7; **Implementato in 0.30.0**).
- Il canone resta intoccabile: un'invenzione che contraddice il canone è un errore come un altro, e il revisore di lotto lo segnala (decisione 7).
- Una lacuna che il framework non riempie resta aperta nel modello della scheda, nella sezione `## Da definire`. Se la sezione resti in uso, è questione aperta (vedi Questioni aperte) (**Proposta**).

## 15. Le dipendenze fra eventi sono dichiarate

**Proposta**: ogni sessione o attività di trama dichiara il prerequisito, cioè la sessione o la sezione che deve essere giocata prima, nel campo `depends_on` dei suoi metadati (l'unico posto in cui sta). Il campo e la mappa della trama sono **Implementati in 0.30.0**. Il meccanismo vale per ogni struttura a sequenza (campagne a capitoli, a missioni, a stagioni) ed è verificabile.

**Motivazione.** Un ordine implicito obbliga il master a ricordare la struttura. Una dipendenza dichiarata la rende leggibile e la fa verificare.

**Conseguenze pratiche.**

- Ogni attività di trama dichiara i prerequisiti. Una attività senza prerequisiti lo dichiara esplicitamente (**Proposta**).
- La mappa della trama è un derivato delle dichiarazioni. Quando la struttura cambia, la mappa si rigenera (**Implementato in 0.30.0**).
- Il controllo del grafo della trama segnala gli errori (**Implementato in 0.30.0**). La verifica dei cicli fra dipendenze è **Proposta**.

## 16. YAGNI: solo ciò che serve oggi

**Deciso** (indice). La Riprogettazione lo applica: sono stati tolti il runner dei processi, gli argomenti e gli handoff, il plugin per Codex e le istruzioni di ripiego (Riprogettazione, sezione 9).

**Motivazione.** Un framework per chi non programma deve restare piccolo e comprensibile. Ogni cartella, campo o modulo previsto «per quando servirà» è una cosa in più da spiegare, mantenere e migrare, e spesso il bisogno reale arriva in una forma diversa da quella immaginata.

**Conseguenze pratiche.**

- Una funzione, un campo di configurazione o una cartella entra nel framework solo quando una campagna reale ne ha bisogno.
- Le estensioni immaginate restano nelle questioni aperte o in un elenco «fuori dalla prima versione», non nella struttura.
- Fra due soluzioni che risolvono lo stesso problema si sceglie quella con meno parti. Un motore unico al posto di più skill con rapporti di testo fra loro è un esempio di questa scelta (Riprogettazione, sezione 2).
- YAGNI non giustifica scorciatoie sulla robustezza: verifiche, casi di prova e separazione pubblico/riservato servono già oggi.

## 17. Il framework inventa e dichiara: la fantasia è sbloccata per default

**Deciso, 2026-11-11** (Riprogettazione, decisione 7). **Superata dalla Riprogettazione (2026-11-11)**: la decisione dell'indice «Fantasia del modello, bloccata per default» (2026-11-10) è sostituita, perché il blocco generava lacune e domande che il master non voleva; la regola di provenienza del principio 14 prende il suo posto.

**Motivazione.** Un mondo narrativo completo, con luoghi, personaggi ed eventi, non si costruisce senza invenzione. Il rischio non è l'invenzione in sé, ma l'invenzione che il master non vede. Per questo la regola è inventare e dichiarare, e tenere la provenienza.

**Conseguenze pratiche.**

- Per default il framework inventa ciò che le fonti non danno, senza chiedere il permesso prima (decisione 7).
- I valori `IMAGINATION` e `PROPOSE`, la chiave `allow_model_imagination` e la domanda a quattro risposte sono sostituiti dalla regola di provenienza (decisione 7; **Implementato in 0.30.0**: la chiave è ignorata e la migrazione la toglie).
- Restano ferme le regole che limitano l'invenzione: il canone non si contraddice; segreti e contenuti riservati stanno solo nel blocco master; un'invenzione non si presenta mai come citazione di una fonte; la cronaca dopo la sessione riporta solo ciò che il master racconta; la trascrizione del materiale importato è fedele alla fonte (decisione 7).
- Il master sa sempre che cosa è stato inventato: il framework lo dichiara in una frase, e la provenienza lo segna nel documento (decisioni 6 e 7).
- Il master può chiedere di cambiare un'invenzione parlando (decisione 3). Il framework riscrive il documento generato, che non è più soggetto a un permesso.

## Glossario

I termini della colonna «Termine interno» sono usati nei documenti di progetto e negli script, e nelle prose della specifica compaiono con il nome indicato in quella colonna. Il master non li vede mai: nei messaggi e nelle schermate compare solo la colonna «Cosa vede il master». Le voci «Cosa vede il master» sono le uniche parole mostrate all'utente. Le voci aggiunte o cambiate dalla Riprogettazione hanno una formulazione **proposta** per il master, da verificare con l'esperienza d'uso.

| Termine interno | Cosa vede il master | Significato |
|---|---|---|
| Skill | Il nome dell'operazione, o nulla | Un'istruzione specializzata che l'agente segue per un tipo di lavoro |
| Skill di core (processo) | Il nome del processo (per esempio «Prepara la sessione») | Processo che il master vive, riconosciuto dall'autore dal messaggio (Riprogettazione, sezione 8) |
| Skill di libreria | «Strumento» o nulla | Operazione specialistica richiamata dal core |
| Modulo | «Impostazione» o «Stile» | Estensione opzionale attivata dalla configurazione |
| Adattatore di sistema | «Regole del gioco» | Modulo che descrive la forma delle schede di un gioco (schema) e la sua aritmetica; non contiene le tabelle delle regole |
| Profilo di stile | «Stile delle immagini» | Insieme di indicazioni visive per carte, ritratti e mappe (**Proposta**) |
| Core | Non visibile | Insieme dei processi e delle regole fisse del framework |
| Libreria | Non visibile | Insieme degli strumenti specialistici |
| Autore (agente principale) | «L'assistente» | Agente di alto livello che parla con il master, scrive mondo, schede e scene, e decide |
| Portineria | Non più usata | Superata dalla Riprogettazione (2026-11-11): il ruolo di ingresso è dell'autore; non esiste più un sub-agent dedicato |
| Sub-agent | «Un assistente» | Agente delegato per un compito distinto: esecutore economico o revisore di lotto |
| Esecutore economico | Non visibile | Sub-agent a modello economico che riceve un ordine preciso (per esempio espandere un abbozzo in scheda) |
| Revisione indipendente | «Controllo di un secondo assistente» | Verifica fatta da un agente che non ha scritto la bozza; per i lotti che aggiungono fatti (Riprogettazione, decisione 5) |
| Modello economico | Non visibile | Modello meno costoso (per esempio Haiku) usato per l'esecuzione |
| Codex | Non visibile | Altro agente di programmazione, fuori dal framework dopo la Riprogettazione (decisione 11); al più fornitore di immagini facoltativo |
| Orchestrazione | Non visibile | Insieme di regole con cui l'autore distribuisce il lavoro |
| ImageGen | «Generatore di immagini» | Strumento di generazione immagini usato dall'agente (**Proposta**) |
| Prompt | «Descrizione per l'immagine» | Istruzione scritta per un generatore di immagini (**Proposta**) |
| MCP | Non visibile | Collegamento con un'applicazione esterna (per esempio il programma di grafica) (**Proposta**) |
| Repository | «La campagna» | Cartella che contiene la campagna e il suo storico |
| Commit | «Versione salvata» | Stato dei file registrato nello storico, a cui si può tornare. È anche il comando del motore che scrive la campagna |
| Motore | Non visibile | Programma a riga di comando (`engine.mjs`) che controlla, scrive e salva; l'autore lo chiama con una chiamata per operazione |
| Pacchetto di contesto | Non visibile | Riassunto compatto di ciò che serve per scrivere una scheda, prodotto dal motore (`context`) |
| Seme del mondo | «Il seme del mondo» | Documento con genere, temi, conflitti e convenzioni del mondo, sempre presente nel lavoro dell'autore |
| Scaletta | «Piano delle schede» | Elenco breve di tutto ciò che si sta per creare, con i legami già decisi |
| Abbozzo | «Abbozzo» | Documento valido del canone, minimo, marcato con `sketch: true`, da espandere quando serve |
| Provenienza | «Origine del documento» | Chi ha prodotto il contenuto: «detto dal master», «giocato», «generato» |
| Nota sul lavoro in corso | «Dove eravamo rimasti» | Nota breve, aggiornata a ogni scrittura, che serve a riprendere il lavoro |
| Ripristino | «Torna a com'era» | Riporto di una o più parti della campagna a una versione salvata (**Proposta**) |
| Migrazione | «Aggiornamento della struttura» | Passaggio dichiarato che sposta o trasforma i contenuti dopo un aggiornamento |
| Versione del framework | «Versione» (solo in una nota) | Numero che identifica il pacchetto del framework con cui la campagna è stata creata o aggiornata |
| Aggiornamento | «Aggiornamento disponibile» | Installazione di una versione più recente del framework |
| Manifest | Non visibile | Dichiarazione del contenuto di un pacchetto. Il pacchetto per Claude Code usa `.claude-plugin/plugin.json`; un `manifest.yaml` è **Proposta** |
| Template | Non visibile | Modello da cui si generano schede o istruzioni |
| Configurazione | «Impostazioni della campagna» | File `campaign.yaml`, che descrive la forma della campagna |
| Personalizzazioni | «Le tue regole» | File `.campaign/customizations.md`, in cui il master aggiunge regole proprie, mai sovrascritto (**Proposta**) |
| Hook | «Controllo automatico» | Azione che parte da sola in un momento definito, per esempio all'avvio |
| Script deterministico | Non visibile | Programma che produce sempre lo stesso risultato dagli stessi file |
| Caso di prova (test) | Non visibile | Esempio con esito atteso, usato per verificare un cambiamento |
| Audit di continuità (`continuity-audit`) | «Controllo di coerenza» | Verifica che i documenti non si contraddicano; su richiesta, non nella scrittura (Riprogettazione, decisione 5) |
| Collegamenti | «Collegamenti» | Inserimento dei rimandi fra le schede, eseguito dal motore in `commit`; non è più una skill |
| Ricerca nel canone (`canon-research`) | «Che cosa dice la campagna» | Superata dalla Riprogettazione (2026-11-11): le domande sul mondo le risponde l'autore con le query del motore e la lettura dei documenti |
| Tracker degli scontri (`combat-tracker`) | «Scontro» | Conto di iniziativa, punti ferita e turni durante un combattimento (**Proposta**) |
| Registro di sessione (`session-log`) | «Registro della partita» | Note di che cosa accade al tavolo; non è canone (**Proposta**) |
| Indice derivato | «Mappa» o «Enciclopedia» | Documento generato dai contenuti, da non modificare a mano |
| Indice dei soggetti | Non visibile | Derivato (`.campaign/cache/subjects.json`) dagli alias delle schede |
| Indice del mondo | Non visibile | Derivato (`.campaign/cache/world.json`) da tipi, relazioni, cronologia e fatti: base dei controlli del grafo |
| Alias (`aliases`) | «Altri nomi» | Forme alternative del nome di un soggetto |
| Mappa della trama | «Mappa della trama» | Indice grafico delle sessioni e delle loro dipendenze |
| Metadati | «Dati della scheda» (solo nei documenti) | Blocco di dati in testa a un file Markdown (per esempio `id`, `kind`, `provenance`, `location`, `relations`, `when`, `status`, `sketch`, `depends_on`, `aliases`, `template`) |
| Markdown | «Scheda» o «documento» | Formato dei testi della campagna |
| Blocco master | «Note del master» | Parte riservata in fondo a una scheda |
| Ancora | Non visibile (il rimando funziona) | Punto preciso di un documento a cui si rimanda |
| Stato di lavoro | «Appunti della partita» | Dati temporanei di una sessione live o di uno scontro, in `.campaign/state/`: separati dal canone e cancellabili senza effetti sul mondo |
| Sessione live | «Partita in corso» | Gestione della partita durante il gioco (**Proposta**) |
| Sessione di lavoro | «Conversazione» | Una conversazione con l'agente. La ripresa non dipende più da una sessione salvata, ma dal pacchetto di contesto e dalla nota sul lavoro in corso (Riprogettazione, decisione 15) |
| Argomento | Non più usato | Superato dalla Riprogettazione (decisione 15): non esistono più argomenti salvati |
| Handoff | Non più usato | Superato dalla Riprogettazione (decisione 15): sostituito dalla nota sul lavoro in corso |
| Sessione (documento) | «Sessione» | Documento di una giocata o di un'attività di trama, in `Trama/` |
| Stato di stampa (metadato `print`) | «Da stampare», «Stampata», «Da ristampare» | Stato fisico della carta di un oggetto (`to-print`, `printed`, `reprint`) (**Proposta**) |
| Tela libera | «Tela libera» | Area libera del master screen, senza struttura fissa (**Proposta**) |
| Master screen | «Schermo del master» | Strumento grafico locale del master: chat, consultazione, sessione live, musica, stampa (**Proposta**) |
| PSD | «File di lavoro del disegno» | File a livelli per la modifica di una carta (**Proposta**) |
| PNG | «Immagine» | Formato di immagine finale (**Proposta**) |
| JSON, YAML | «Dati» | Formati di file per i dati strutturati |

## Questioni aperte

- La forma della campagna può essere spezzata in più file (una parte per il mondo, una per le regole)? Il principio 13 presume un file solo.
- Il principio 15 generalizza le dipendenze fra sessioni a ogni struttura a sequenza. Va verificato con almeno due tipi di campagna diversi che il meccanismo regga.
- Fino a dove un principio può essere sacrificato per la semplicità della prima versione (per esempio il blocco riservato o la versione salvata invisibile)? La prima versione va definita come insieme minimo di principi non negoziabili.
- **Visibilità del blocco riservato per gli esecutori economici** (nuova, 2026-11-11). La Riprogettazione dice che il revisore di lotto vede il blocco riservato, ma non dice se lo vede anche l'esecutore che scrive una scheda, dato che la scheda contiene il proprio blocco `## Master`. Va deciso, con il principio 4.
- **Sezione `## Da definire` nelle schede** (nuova, 2026-11-11). Con la fantasia sbloccata (principio 14) il framework riempie le lacune con invenzioni dichiarate, ma i modelli di scheda della versione 0.30.0 prevedono ancora la sezione `## Da definire`. Va deciso se la sezione resta, e in che senso.
