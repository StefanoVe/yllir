# Aggiornamento di Yllir dal master screen

**Stato:** Implementato (2026-11-14, master screen 0.4.0) secondo l'ipotesi di lavoro, con le scelte dell'autore: avviso rimandabile ("più tardi" = un giorno), aggiornamento solo dal tasto (il gate dell'agente resta com'è), versione pubblicata letta dal repo GitHub `StefanoVe/yllir` (solo GET anonime). Il riavvio lancia il launcher del plugin aggiornato in un processo staccato dopo l'uscita del vecchio server, e si apre una nuova scheda (la porta può cambiare). Dopo il riavvio (e a ogni apertura che lo richieda) un modale dedicato allinea la campagna: il server esegue il controllo deterministico e un turno dell'agente con modello Sonnet e prompt fisso lancia l'allineamento e i passi guidati di post-update; il campo di testo si attiva solo per rispondere a una domanda, e a lavoro finito c'è un pulsante per chiudere. Non verificato su Windows né con un aggiornamento reale end to end. Si appoggia a `Aggiornamenti e migrazioni.md`, `Master screen.md` e `Installazione e requisiti.md`.

## Problema

Oggi il master screen si aggiorna solo insieme al framework: il master aggiorna il plugin, riavvia il launcher e il launcher scarica il nuovo pacchetto (versione fissata nel pin `yllir/master-screen.json`, SHA-256 dal file `.sha256` della release). Dentro il master screen non c'è alcun modo di saperlo né di farlo.

Dalla chat non si può fare: la skill `update` chiede il sì al master e poi lancia `claude plugin update yllir@yllir`, ma il gate dell'agente nel master screen permette come Bash solo `node <framework>/scripts/…`. Il comando viene rifiutato e il master legge solo che l'aggiornamento non è stato applicato. Inoltre il server in esecuzione resta quello vecchio finché il launcher non viene riavviato.

## Obiettivo

Il master vede nel master screen che c'è una novità, la legge in parole semplici, dice di sì con un tasto, e dopo pochi secondi trova la schermata aggiornata, senza terminale e senza chiudere nulla a mano.

## Ipotesi di lavoro (da approvare)

- **Avviso.** Il server confronta la versione installata (`frameworkVersion`, già in `/api/status`) con quella pubblicata e la sezione "Novità" già prodotta dal controllo di aggiornamento. Il client mostra un avviso discreto nella barra laterale o nelle impostazioni, con le novità riscritte con le parole del lessico. Mai una versione o un numero.
- **Azione.** Un pulsante "Aggiorna ora" nelle impostazioni, non un permesso nuovo per l'agente. Il server esegue l'aggiornamento (`claude plugin update yllir@yllir --json`, via `execFile`, mai una shell, un solo aggiornamento alla volta, timeout). L'agente della chat resta con il gate attuale.
- **Riavvio.** Finito l'aggiornamento il server avvia il launcher aggiornato, che scarica il pacchetto del master screen se la versione è cambiata, verifica il pacchetto con lo SHA-256 del file `.sha256` della release e parte. La pagina si ricollega da sola (c'è già la risincronizzazione del canale live).
- **Campagna.** All'apertura successiva l'allineamento della campagna (`update-campaign.mjs`) gira come oggi, con la solita frase fissa e le novità. Un aggiornamento interrotto offre "continua" o "torna com'era".
- **Sicurezza.** Nessun dato della campagna esce. Si scarica solo dalla release GitHub già fissata nel framework. Se il tasto fallisce il master legge in una frase che nulla è cambiato.
- **Senza rete.** Il tasto è disattivato con una frase che lo spiega, e il master screen continua a funzionare con la versione che ha.

## Da verificare prima

- Se `claude plugin update` si può lanciare dal processo del master screen (PATH, trovare Claude Code come fa già il provider, percorso del plugin installato a partire da `frameworkRoot`).
- Come il server trova la versione pubblicata senza `YLLIR_PUBLISHED_SOURCE` (vedi questioni aperte di `Aggiornamenti e migrazioni.md`).
- Come si riavvia il server in modo pulito su macOS e Windows, mantenendo la porta e la scheda del browser.
- Se l'avviso "aggiornamento disponibile" dell'hook di sessione parte anche dentro la chat del master screen.
- Cosa succede se durante l'aggiornamento c'è un turno dell'agente in corso o una sessione live aperta: ipotesi, il tasto aspetta o rifiuta con una frase chiara.

## Questioni aperte

- Il master deve poter rimandare l'avviso ("più tardi") come nella skill `update`, o l'avviso resta sempre visibile?
- L'aggiornamento parte sempre dal tasto, o anche dalla chat quando il master lo chiede? (La seconda richiede di allargare il gate: da decidere con l'autore.)
- Serve poter tornare alla versione precedente del master screen dopo un aggiornamento riuscito ma sgradito? Il launcher conserva già le versioni scaricate in `~/.yllir/master-screen/<versione>/`.
