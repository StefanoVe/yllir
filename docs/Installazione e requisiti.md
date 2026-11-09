# Installazione e requisiti

**Stato:** Bozza di progetto
**Parte di:** [Framework per campagne di GDR](Framework%20per%20campagne%20di%20GDR.md)

Questo documento stabilisce che cosa serve per usare il framework, come si installa per chi non ha mai aperto un terminale, come si verifica che l'installazione funzioni, che cosa succede quando qualcosa manca o si rompe, e come si disinstalla. Sviluppa la sezione «Installazione per chi non ha mai aperto un terminale» di [Esperienza utente](Esperienza%20utente.md) e non la contraddice; dove la contraddizione è inevitabile, è segnalata nelle questioni aperte.

Convenzioni: **Deciso** indica ciò che è nell'indice o è una decisione dell'autore; **Proposta** indica le scelte di questo documento, da confermare. Le informazioni sui servizi di terze parti che non sono verificate sono marcate **da verificare**. Non compaiono prezzi: i piani e i costi cambiano e vanno letti sui siti dei fornitori.

## 1. Requisiti minimi della prima versione

### 1.1 Da dove si lavora

**Deciso.** La prima versione gira nel terminale o nell'app di Claude. Non esiste ancora un'interfaccia dedicata: il [master screen](Master%20screen.md) è un passo successivo.

**Proposta.** Il percorso principale passa dallo strumento da terminale di Claude, installato e avviato dall'installatore. Il master non digita comandi: apre il collegamento che l'installatore crea e indica la cartella della campagna, come al passo 7 della sezione 3.2. L'app di Claude è un percorso alternativo solo se si verifica che esegue i controlli automatici, gli script e i sub-agent del framework (**da verificare**; vedi questioni aperte). Per le funzioni che richiedono hook e sub-agent, come descritte in [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md), il percorso principale è quello che le supporta tutte.

### 1.2 Computer e sistemi operativi

**Proposta, da decidere.** Il framework è pensato per un computer personale del master. Non richiede un server.

| Sistema | Proposta per la prima versione | Note |
|---|---|---|
| macOS (ultime due versioni principali) | Supportato | La versione minima esatta è **da verificare** sulle versioni rilasciate dallo strumento di Claude. Le istruzioni per aprire il terminale in [Esperienza utente](Esperienza%20utente.md) restano valide come alternativa. |
| Windows 11 | Supportato, da confermare | Richiede Git e Node installati dall'installatore; le istruzioni per il terminale puntano a PowerShell, come in [Esperienza utente](Esperienza%20utente.md). |
| Windows 10 | Da decidere | Dipende dal supporto che lo strumento di Claude offre a quel sistema (**da verificare**). |
| Linux | Fuori dalla prima versione | Non è il pubblico previsto dalla specifica. Lo stesso installatore può essere esteso in seguito. |
| Tablet e telefoni | Non supportati | Il framework scrive file nella cartella del computer. |

**Hardware.** Nessun minimo fissato. La prima versione non esegue modelli in locale: il computer deve poter far girare lo strumento di Claude, Git, Node e un editor di testo. Il minimo reale va misurato sulle versioni rilasciate (**da verificare**).

### 1.3 Account e abbonamento

| Servizio | Serve per | Obbligatorio |
|---|---|---|
| Account Claude con un piano che consente l'uso dello strumento scelto | L'assistente, che esegue quasi tutto il lavoro sulla campagna | Sì. Il piano minimo è **da verificare** sul sito del fornitore. |
| Account OpenAI con accesso a Codex e a ImageGen | Illustrazioni e alcune revisioni con Codex | No. Requisiti di accesso **da verificare**. |
| Account Adobe con Photoshop | Carte a livelli, rifiniture generative, anteprime | No. Le funzioni generative dipendono dal piano Adobe (**da verificare**). |
| Account presso un fornitore di immagini via API, con chiave | Generazione di immagini alternativa | No. Il fornitore va scelto e verificato al momento dell'adozione. |
| Account di hosting e dominio | Pubblicazione dell'enciclopedia | No. Nessun servizio è ancora scelto. |

Regole:

- **Proposta.** Il framework non gestisce pagamenti e non chiede dati di carte di credito. Acquisti e abbonamenti si fanno sui siti dei fornitori.
- **Proposta.** Nessun account è richiesto per la campagna, le schede, i collegamenti, l'audit di continuità o le versioni salvate, che funzionano in locale.

### 1.4 Strumenti da installare

| Strumento | A che cosa serve | Stato | Come arriva sul computer |
|---|---|---|---|
| Strumento di Claude (terminale o app) | L'assistente | Obbligatorio | Scaricato dal sito ufficiale; l'installatore lo propone e lo avvia se manca. |
| Git | Conserva le versioni salvate della campagna. Il master non lo vede mai. | Obbligatorio (**Deciso**): senza, il framework non scrive | Installato dall'installatore se manca. |
| Node.js, versione LTS | Esegue gli script deterministici: controllo dei collegamenti, validazione, indici, controllo dell'installazione | Obbligatorio (**Proposta**) | Installato dall'installatore se manca. |
| Editor di testo | Il master può leggere e correggere le schede a mano | Facoltativo | Non serve: va bene qualunque editor di Markdown o di testo. |

**Deciso: runtime per gli script, Node.js.** Tra le opzioni (Node.js, Python, script di shell) è stata scelta Node.js, per quattro motivi:

1. Un solo runtime dà lo stesso esito su macOS e Windows. Uno script di shell, invece, cambia fra i due sistemi, e il controllo deterministico deve produrre risultati identici (vedi [Principi](Principi.md)).
2. La specifica già nomina Node tra i requisiti degli strumenti di impaginazione e di verifica nel browser, e il master screen futuro è pensato per girare in locale (vedi [Integrazioni esterne](Integrazioni%20esterne.md) e [Master screen](Master%20screen.md)). Un solo ambiente serve a tutto, senza installarne un secondo per gli script.
3. Python non è garantito di default su entrambi i sistemi (**da verificare**). La specifica della stampa, inoltre, evita esplicitamente la dipendenza da Python per leggere i modelli ([Master screen](Master%20screen.md)).
4. Le librerie necessarie possono essere incluse nel pacchetto del framework, così l'installatore non deve installare programmi separati per la composizione dei fogli o dei QR. Questo riduce i requisiti ma va verificato sulle licenze delle librerie (**da verificare**).

La versione minima di Node non si fissa qui: si sceglie al momento del rilascio, tra le versioni LTS in corso.

**Git: motivazione.** Le versioni salvate, il «torna a com'era» e la storia dei file passano tutti da Git ([Architettura](Architettura.md), sezione 5; [Esperienza utente](Esperienza%20utente.md)). Senza Git non esiste una versione salvata a cui tornare, e per questo la scrittura è bloccata (vedi sezione 4). Per questo Git è obbligatorio, e la creazione di una campagna ne inizializza il repository.

### 1.5 Spazio su disco e connessione

**Spazio su disco.** Proposta, stima prudenziale da verificare: almeno 5 GB liberi per lo strumento di Claude, Git, Node e il pacchetto del framework. La campagna in sé, cioè testi e schede, occupa poco; lo spazio cresce con le immagini, le fonti scansionate e la storia delle versioni salvate. Lo spazio per Photoshop o per una generazione locale è dichiarato dal modulo (sezione 2) e va verificato.

**Connessione.**

- Serve per installare, per accedere a Claude, per usare l'assistente, per cercare aggiornamenti e per i servizi online.
- Senza connessione restano disponibili: la lettura e la modifica a mano delle schede, i controlli deterministici dei collegamenti, la stampa dei fogli già generati e le versioni salvate.
- Non sono disponibili: l'assistente, la generazione di immagini con servizi online e i flussi musicali online.
- La generazione locale di immagini, se mai sarà un'opzione, dovrebbe funzionare senza rete dopo l'installazione (**da verificare**).

**Cartella della campagna.** **Proposta.** La cartella va creata in un percorso locale, non sincronizzato con servizi online. Alcune configurazioni dei sistemi operativi sincronizzano con il cloud le cartelle personali di uso comune: in quel caso una cartella della campagna può essere copiata online, con copie in conflitto e storia delle versioni danneggiata. Il controllo dell'installazione (sezione 3.4) segnala questa situazione; la campagna non viene spostata automaticamente.

## 2. Requisiti opzionali per modulo

**Proposta.** Ogni modulo è attivato dalla configurazione della campagna ([Configurazione](Configurazione.md)) solo se il master lo chiede. Un modulo senza i requisiti resta spento, e il framework lo dice una volta sola, in linguaggio semplice. Nessun modulo opzionale è installato dall'installatore senza che il master lo scelga; i moduli vengono proposti quando servono.

| Modulo | Che cosa serve | Che cosa succede se manca |
|---|---|---|
| **Codex** (illustrazioni con ImageGen, alcune revisioni) | Codex installato; accesso con un account che ha ImageGen (**da verificare**). Quando si usa Codex, l'installatore deve consentirgli di scrivere nella cartella `.git` della campagna (impostazione `sandbox_workspace_write.writable_roots`), altrimenti le versioni salvate falliscono. *Verificato con una prova, da inserire nell'installatore.* | **Deciso** in [Orchestrazione degli agenti](Orchestrazione%20degli%20agenti.md#fallback): se Codex manca, la generazione passa al fornitore successivo nell'ordine configurato; se nessuno è disponibile, si ferma e il framework lo dice. Le revisioni affidate a Codex passano a un revisore dell'altra famiglia o a un revisore Haiku (**Proposta**, stessa sezione). |
| **Photoshop e il suo server MCP** (carte a livelli, rifiniture generative) | Photoshop installato; server MCP collegato; funzioni generative attive con il piano Adobe (**da verificare**) | Le carte si producono senza PSD a livelli, oppure non si producono (da decidere, vedi [Integrazioni esterne](Integrazioni%20esterne.md)). Le rifiniture generative non sono disponibili. Il framework lo dichiara sulla carta. |
| **Chiavi API dei fornitori di immagini** | Account presso il fornitore e chiave, conservata sul computer e mai nei file della campagna ([Integrazioni esterne](Integrazioni%20esterne.md), sezione 6) | Il fornitore resta spento; gli altri fornitori attivi restano disponibili. |
| **Generazione locale di immagini** | Computer con scheda grafica adeguata, spazio su disco, installazione guidata (requisiti **da verificare**) | Non attiva. Nessuna conseguenza sul resto. |
| **Musica** (riproduzione dei sottofondi e dei cue) | Un programma di riproduzione, da scegliere (**da verificare**); connessione per i flussi online | Il pannello musica non compare. I link musicali restano nelle schede. Per i flussi online, la liceità dipende dai termini dei servizi (**da verificare**). |
| **Stampa** (fogli 5×7 e A4, carte, annunci) | Strumenti di composizione inclusi nel pacchetto (**Proposta**, vedi sezione 1.4); font dichiarati e installati dal framework; stampante non richiesta, il PDF basta | I fogli non si generano. Lo stato di stampa resta nelle schede. |
| **Pubblicazione dell'enciclopedia** | Account di hosting, programma a riga di comando del servizio scelto, dominio (**da verificare**) | L'enciclopedia resta una raccolta di pagine locali, consultabile sul computer. Nulla viene pubblicato. |
| **Browser di verifica** (controllo visivo dell'enciclopedia) | Un browser e gli strumenti di verifica (**da verificare**) | Il controllo dei collegamenti resta, perché è deterministico. Manca il controllo visivo, e il framework dichiara che non è stato fatto. |
| **Lettura di PDF scansionati** (importazione di appunti) | Uno strumento di riconoscimento del testo (**da verificare**) | I PDF scansionati non si leggono come testo. Le foto restano leggibili dall'assistente, se il servizio lo consente (**da verificare**). |
| **Master screen** | **Deciso:** non è nella prima versione. In seguito, un'app locale senza servizi esterni | Nessun master screen: si lavora dal terminale o dall'app di Claude. Nulla cambia nel resto. |
| **Skill documentali** (PDF, Word, presentazioni) | Disponibili nell'ambiente di Claude, non nel pacchetto | Dispense e schede stampabili restano in formato Markdown o si producono con i fogli di stampa. |

## 3. Percorso di installazione per chi non ha mai aperto un terminale

### 3.1 Prima di cominciare

- Un computer macOS o Windows supportato (sezione 1.2).
- Una connessione a internet.
- Circa 5 GB liberi (stima, sezione 1.5).
- Un indirizzo e-mail per l'account Claude.
- Del tempo: l'installazione richiede qualche minuto, senza interventi tecnici.

Il percorso principale non richiede di aprire il terminale. Se un passo chiede una password, è la password del computer: serve per installare programmi.

### 3.2 I passi

1. **Controlla il computer.** Verifica che il sistema sia tra quelli supportati e che ci sia spazio. Se il computer è di lavoro, controlla con chi lo gestisce che l'installazione di programmi sia consentita.
2. **Crea l'account Claude.** Dal sito ufficiale del fornitore, crea l'account e controlla il piano necessario allo strumento scelto (**da verificare**, nessun prezzo qui).
3. **Scarica l'installatore.** Dalla pagina ufficiale del framework (nome e indirizzo da decidere). Controlla che sia la pagina giusta: l'installatore si scarica solo da lì, e la pagina riporta l'impronta di controllo del file (**Proposta**).
4. **Apri il file e segui le finestre.** L'installatore verifica il file, installa i componenti di base che mancano (sezione 1.4), installa o collega l'assistente, copia il pacchetto del framework in una posizione del sistema e crea il collegamento per avviarlo. Può chiedere la password del computer. Non installa moduli opzionali.
5. **Accedi a Claude.** Quando lo strumento lo chiede, si apre la finestra di accesso dell'account creato al passo 2.
6. **Attendi il controllo dell'installazione** (sezione 3.4). Alla fine mostra l'esito in linguaggio semplice.
7. **Crea la prima campagna.** Crea una cartella vuota, con il nome della campagna, in un percorso locale e non sincronizzato (sezione 1.5). Apri il collegamento creato dall'installatore, indica la cartella e scrivi una frase: per esempio «voglio creare una nuova campagna». Il framework propone la creazione, come descritto in [Esperienza utente](Esperienza%20utente.md), e inizializza subito il repository delle versioni salvate.

### 3.3 Alternativa: comando unico

**Proposta, secondaria.** Per chi ha già usato il terminale, la pagina ufficiale può proporre un unico comando da incollare. Il comando scarica lo stesso installatore del passo 3, verifica l'impronta e lo avvia. Non è il percorso predefinito, perché un comando copiato da una pagina è più facile da sbagliare e da falsificare. Il percorso principale resta l'installatore.

Per aprire il terminale, le istruzioni sono quelle di [Esperienza utente](Esperienza%20utente.md): su macOS, Cmd e barra spaziatrice e «Terminale»; su Windows, «PowerShell» dal menu Start.

### 3.4 Il controllo dell'installazione

Alla fine dell'installazione, e ogni volta che il master lo chiede con una frase come «controlla che tutto funzioni», il framework esegue il **controllo dell'installazione**. È uno script deterministico ([Principi](Principi.md)): verifica ciò che si può verificare con una regola, e dichiara come non verificato ciò che non ha potuto controllare.

| Controllo | Come si verifica | Esito se fallisce |
|---|---|---|
| Sistema supportato | Versione del sistema operativo | Non pronto: sistema non supportato. |
| Strumento di Claude presente e accesso attivo | Presenza dello strumento e prova di accesso leggera (**da verificare** che non consumi risorse) | Non pronto: accesso da completare. |
| Git presente e configurato | Presenza e versione minima; identità locale impostata una volta dall'installatore con un nome generico | Non pronto: manca lo strumento delle versioni salvate. Nessuna scrittura è possibile (sezione 4). |
| Node presente, versione minima | Presenza e versione | Non pronto: manca il componente di controllo. |
| Pacchetto integro | Impronte dei file del framework (vedi [Aggiornamenti e migrazioni](Aggiornamenti%20e%20migrazioni.md)) | Avviso: alcuni file sono cambiati. |
| Cartella di prova scrivibile | Creazione e rimozione di un file di prova in una cartella di prova | Non pronto: la cartella non è scrivibile. |
| Cartella non sincronizzata | Percorso confrontato con le cartelle che i sistemi sincronizzano con il cloud (euristica) | Avviso: la cartella può essere copiata online. |
| Versioni salvate e ritorno | Una campagna di prova temporanea: crea, modifica, salva e torna indietro, poi la rimuove | Non pronto: le versioni salvate non funzionano. |
| Moduli opzionali | Presenza dei requisiti di ciascun modulo attivo (sezione 2) | Non è un errore: il modulo resta spento e il controllo lo dice. |

**Esito, in linguaggio semplice.** Tre forme possibili:

- **Tutto pronto.** «L'installazione funziona. Puoi creare la tua prima campagna.»
- **Pronto, con limitazioni.** «Puoi lavorare. Alcune funzioni non sono attive: [elenco in una riga per ciascuna]. Puoi attivarle quando vuoi.»
- **Non ancora pronto.** «Non posso ancora lavorare sulla campagna perché [motivo in una frase]. Per risolvere: [azione]. Nulla nella tua cartella è stato cambiato.»

Un controllo che non ha potuto girare è dichiarato «non verificato», mai «riuscito». Il dettaglio tecnico resta nel registro, come in [Esperienza utente](Esperienza%20utente.md).

## 4. Rilevamento di ciò che manca o si è rotto

### 4.1 Quando il controllo gira

**Proposta.** Il controllo leggero gira:

- all'avvio di ogni sessione con il framework;
- alla prima richiesta che usa uno strumento o un modulo;
- quando il master lo chiede.

Il controllo non blocca la lettura delle schede. Blocca solo ciò che richiederebbe lo strumento mancante.

### 4.2 Messaggi e azioni

Ogni messaggio dice tre cose: che cosa non funziona, che cosa non è cambiato, che cosa fare. Nessun messaggio riporta un codice d'errore, un percorso di sistema o un testo di log. Lo stesso problema non si ripete a ogni richiesta: si ricorda per la sessione, e torna alla sessione successiva solo se è ancora aperto.

| Che cosa si rileva | Messaggio al master (esempio) | Azione proposta | Effetto sul lavoro |
|---|---|---|---|
| Accesso a Claude scaduto o non attivo | «Non riesco a collegarmi all'assistente: l'accesso sembra scaduto. Accedi di nuovo all'assistente, poi riprendiamo.» | Accedi di nuovo; se il piano non basta, controlla sul sito del fornitore. | Nessuna richiesta all'assistente finché non si accede. La lettura resta possibile. |
| Strumento di Claude disinstallato | «Non trovo più lo strumento con cui lavoriamo. Rilancia l'installatore: ritrovo la campagna com'è.» | Rilancia l'installatore, che ripara l'installazione (sezione 5). | Nessuna richiesta all'assistente. La campagna non cambia. |
| Git mancante | «Non trovo lo strumento che conserva le versioni salvate. Finché non lo reinstalli non modifico nulla: ogni modifica deve poter tornare indietro.» | Rilancia l'installatore: installa il componente delle versioni salvate. | **Blocco delle scritture**: nessun file della campagna viene modificato senza una versione salvata a cui tornare. |
| Node mancante o troppo vecchio | «Un componente necessario per i controlli è mancante o troppo vecchio. Rilancia l'installatore per ripararlo.» | Rilancia l'installatore. | Blocco dei controlli deterministici; le scritture restano bloccate fino al controllo riuscito. |
| Strumento più vecchio del minimo richiesto dal framework | «Lo strumento X è troppo vecchio per questa versione del framework. Aggiornalo dal suo sito; il framework non lo aggiorna da solo.» | Aggiornare lo strumento (sezione 5). | Solo il modulo che usa X resta spento. |
| Versione della campagna più nuova del framework installato | «Questa campagna è stata creata con una versione più recente del framework. Aggiorna il framework prima di continuare.» | Aggiornare il framework (vedi [Aggiornamenti e migrazioni](Aggiornamenti%20e%20migrazioni.md)). | Blocco delle scritture: la campagna non viene modificata da una versione più vecchia. |
| Chiave di un fornitore di immagini scaduta o revocata | «La chiave del servizio X non funziona più. Inseriscine una nuova, oppure continuiamo senza quel servizio.» | Inserire una nuova chiave o disattivare il fornitore. | Il fornitore resta spento. |
| Generatore di immagini non collegato all'account | «Il generatore di immagini non è collegato al tuo account, quindi non posso creare illustrazioni. Accedi al servizio, oppure continuiamo senza.» | Accedere al servizio di immagini. | Solo le illustrazioni con Codex; il resto prosegue. |
| Programma di grafica chiuso | «Per fare le carte devi aprire il programma di grafica con il documento della carta.» | Aprire il programma di grafica. | Le carte attendono; nessun file viene toccato. |
| Connessione assente | «Non riesco a raggiungere l'assistente: controlla la connessione. Le schede restano leggibili.» | Ristabilire la connessione. | Solo le funzioni online sono ferme. |
| Disco pieno o cartella non scrivibile | «Non posso salvare: il computer non ha più spazio, oppure la cartella è protetta. Nessuna modifica è stata fatta.» | Liberare spazio, o scegliere un'altra cartella. | Blocco delle scritture. |
| Cartella sincronizzata con il cloud | «La cartella della campagna è copiata online, e le versioni salvate potrebbero confondersi. Ti consiglio di spostarla in una cartella locale.» | Spostare la campagna, se il master è d'accordo. | Avviso; nessun blocco. |
| File del framework modificati a mano | «Alcuni file del framework risultano cambiati. Li lascio come sono. Se non ricordi di averli cambiati, ripara l'installazione.» | Riparare l'installazione, oppure tenere la modifica. | Avviso. Le personalizzazioni del master non vengono toccate. |
| Aggiornamento interrotto | «L'ultimo aggiornamento non è finito. Vuoi che lo completi o che torni com'era?» | Scegliere tra completare e tornare indietro (vedi [Aggiornamenti e migrazioni](Aggiornamenti%20e%20migrazioni.md)). | Blocco delle scritture fino alla scelta. |
| Modulo opzionale non attivo | Una riga, una volta sola per sessione, come in sezione 2. | Nessuna, salvo richiesta del master. | Nessuno: il modulo resta spento. |

### 4.3 Blocco e avviso

**Proposta.** Due classi, con regole diverse:

- **Blocco delle scritture**: quando mancano le condizioni che rendono sicura una modifica (Git, versione salvata, versione compatibile, cartella scrivibile). Le letture restano disponibili.
- **Avviso**: quando un servizio o un modulo non è disponibile, ma la modifica resta sicura.

La proposta di [Esperienza utente](Esperienza%20utente.md) prevede di proporre il rimedio in una frase. Qui si aggiunge il blocco per il solo caso delle versioni salvate, perché senza una versione salvata a cui tornare la regola «nessuna modifica senza ritorno possibile» non si può rispettare (**Deciso**).

## 5. Aggiornare gli strumenti esterni e il framework

Sono due aggiornamenti diversi, con chi li fa e quando.

| Che cosa | Chi lo aggiorna | Quando | Dove |
|---|---|---|---|
| Framework | Il framework stesso, con la procedura di [Aggiornamenti e migrazioni](Aggiornamenti%20e%20migrazioni.md) | Su richiesta del master, dopo l'avviso di aggiornamento disponibile | Nella sezione dedicata di quel documento |
| Strumento di Claude | Il suo fornitore, con il proprio meccanismo | Quando il fornitore lo chiede o quando il framework rileva una versione sotto il minimo | Sito del fornitore; il framework dà solo il link |
| Codex, Photoshop, Git, Node | Ciascun fornitore | Come sopra | Sito o meccanismo del fornitore |
| Pacchetto installato, con gli strumenti di base | L'installatore, rilanciato (ripara e aggiorna) | Quando il master lo sceglie o quando il controllo lo chiede | Stesso file dell'installazione |

Regole (**Proposta**):

- Il framework non aggiorna mai uno strumento di terzi senza una richiesta esplicita del master. Non installa aggiornamenti in silenzio.
- Ogni versione del framework dichiara le versioni minime degli strumenti di cui ha bisogno, nel proprio manifest (vedi [Architettura](Architettura.md), sezione 2). Il controllo dell'installazione confronta le versioni installate con questo minimo.
- Se una nuova versione del framework alza un minimo, le note di versione lo dicono, e il controllo avverte prima dell'aggiornamento, non dopo.
- L'installatore è idempotente: rilanciarlo su un'installazione già sana non cambia nulla, e rilanciarlo su un'installazione danneggiata ripara ciò che manca.

## 6. Disinstallazione

**Principio.** La campagna è sempre dell'utente e resta leggibile senza il framework. Disinstallare il framework non tocca i contenuti.

| Elemento | Dopo la disinstallazione |
|---|---|
| Schede, sessioni, mondo, lore, immagini, fonti, cronaca, trama, giocatori | **Restano** intatte. Sono Markdown e immagini, leggibili con qualunque editor. |
| Personalizzazioni del master (`.campaign/customizations.md`) | **Restano**. Sono del master. |
| Storia delle versioni (la cartella Git della campagna) | **Resta**. Può essere eliminata solo su richiesta esplicita del master, con l'avviso che il ritorno indietro non sarà più possibile. |
| Stato di lavoro (partite, scontri, registro) in `.campaign/state/` | **Resta** per impostazione predefinita, perché contiene registri di partite in corso. Si cancella su richiesta. |
| Uscite (enciclopedia, fogli di stampa, mappe derivate) | **Restano** come file statici, che si possono consultare o cancellare. Non sono canone. |
| Istruzioni generate per gli agenti (`.campaign/instructions/`) | **Restano** ma sono inutili senza il framework. Si possono cancellare. |
| Pacchetto del framework, collegamento di avvio, comandi aggiunti | **Vengono rimossi** dal disinstallatore. |
| Git, Node, lo strumento di Claude, Codex, Photoshop | **Non vengono rimossi** per impostazione predefinita: sono programmi usati anche da altro. Il disinstallatore li elenca e chiede se rimuoverli. |
| Chiavi API dei fornitori di immagini | Vengono rimosse dal computer solo su richiesta. **Vanno revocate sul sito del fornitore**: il framework non può farlo, e una chiave resta valida finché non la si revoca. |
| Account Claude, Adobe, OpenAI, hosting | Non vengono toccati. Gli abbonamenti si disdicono sui siti dei fornitori. |

**Proposta.** Il disinstallatore è incluso nell'installatore ed è avviabile dallo stesso punto. Mostra l'elenco di ciò che rimuove e di ciò che resta, e chiede conferma. Dopo la disinstallazione, la cartella della campagna resta come cartella di file normali.

**Reinstallazione.** Reinstallando il framework, la cartella della campagna viene riconosciuta dalla sua configurazione ([Configurazione](Configurazione.md)) e ripresa com'era, senza migrazioni, a meno che la versione della campagna non sia più nuova di quella installata (vedi sezione 4).

## 7. Questioni aperte

1. **Sistemi operativi.** Confermare macOS e Windows 11 come obiettivi della prima versione; decidere se Windows 10 entra e a quali condizioni. Le versioni minime vanno misurate sulle versioni rilasciate (**da verificare**).
2. **Piano Claude.** Quale piano consente l'uso dello strumento scelto, e il framework deve dichiararlo come requisito o limitarsi a un rimando al sito (**da verificare**).
3. **App di Claude come percorso.** Verificare se l'app esegue hook, script e sub-agent del framework. Se no, l'app non è un percorso supportato nella prima versione, e questo va scritto in [Esperienza utente](Esperienza%20utente.md).
4. **Librerie di composizione.** Va decisa se le librerie di composizione (stampa, QR) sono incluse nel pacchetto, con verifica delle licenze, o restano dipendenze esterne come ImageMagick e qrencode, che [Integrazioni esterne](Integrazioni%20esterne.md) elenca fra i requisiti di stampa.
5. **Installatore e fiducia.** Scegliere la forma dell'installatore per macOS e per Windows. Va verificato se serve una firma del programma e che costo comporta (**da verificare**). Va deciso dove vive la pagina ufficiale. Questo risponde in parte alla domanda di [Esperienza utente](Esperienza%20utente.md) sulla provenienza del pacchetto.
6. **Registro tecnico.** Esperienza utente e questo documento parlano di un registro tecnico in cui finiscono i dettagli degli errori. [Architettura](Architettura.md) non lo prevede nell'albero della campagna. Va deciso dove vive, e aggiunto all'albero.
7. **Carte a livelli senza Photoshop.** Se il PSD a livelli diventa una funzione per chi ha Photoshop, il requisito della sezione 2 resta; altrimenti il modulo carte ha un'alternativa da descrivere.
8. **Musica e flussi online.** Scegliere il programma di riproduzione e decidere se i flussi online restano nel pacchetto, con verifica dei termini (**da verificare**), oppure si escludono o si sostituiscono con file caricati dal master.
9. **Spazio e consumo.** Le stime della sezione 1.5 vanno misurate. Va deciso se il framework avverte quando la storia delle versioni supera una soglia, come chiede [Architettura](Architettura.md) in questioni aperte.
10. **Cartelle sincronizzate.** Il controllo le segnala e non blocca. Va confermato che un avviso basta, o se la sincronizzazione deve impedire la scrittura.
11. **Chiavi e loro posto.** Va scelto dove si conservano le chiavi API sul computer, fuori dalla campagna: portachiavi di sistema, file personale o variabile d'ambiente. [Integrazioni esterne](Integrazioni%20esterne.md) fissa solo che non stanno nella campagna.
12. **Disinstallatore e strumenti condivisi.** Va confermato che Git, Node e lo strumento di Claude non vengono rimossi per impostazione predefinita, e che la storia delle versioni può restare dopo la disinstallazione.
13. **Connessione e lavoro offline.** La sezione 1.5 elenca cosa resta disponibile senza rete. Va verificato con l'esperienza reale, soprattutto per la stampa e per la lettura dei controlli.
14. **Permesso di scrittura di Codex sul Git.** Va deciso come l'installatore imposta il permesso di scrittura di Codex sulla cartella `.git` di ciascuna campagna: una regola globale valida per tutte le cartelle, oppure una regola per ogni campagna. Non deciso.
