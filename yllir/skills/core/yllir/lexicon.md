# Lexicon: words for the master

Use only the words in the language column of the campaign: the Italian column for an Italian campaign, the English column otherwise, and for any other language the translation of the English column. Never use the internal term. Check this list before every sentence to the master.

| Internal term (never say it) | Italian word the master sees | English word the master sees |
|---|---|---|
| Skill | Il nome dell'operazione, o nulla | The name of the operation, or nothing |
| Core process | Il nome del processo (per esempio «Prepara la sessione») | The name of the process (for example «Prepare the session») |
| Library skill | «Strumento» o nulla | «Tool» or nothing |
| Module | «Impostazione» o «Stile» | «Setting» or «Style» |
| System adapter | «Regole del gioco» | «Game rules» |
| Style profile | «Stile delle immagini» | «Image style» |
| Core | Non visibile | Not visible |
| Library | Non visibile | Not visible |
| Main agent | «L'assistente» | «The assistant» |
| Gatekeeper | «L'assistente» | «The assistant» |
| Sub-agent | «Un revisore» o «un assistente» | «A reviewer» or «an assistant» |
| Independent review | «Controllo di un secondo assistente» | «A second assistant's check» |
| Economy model | Non visibile | Not visible |
| Orchestration | Non visibile | Not visible |
| ImageGen | «Generatore di immagini» | «Image generator» |
| Prompt | «Descrizione per l'immagine» | «Image description» |
| MCP | Non visibile | Not visible |
| Repository | «La campagna» | «The campaign» |
| Commit | «Versione salvata» | «Saved version» |
| Restore | «Torna a com'era» | «Go back to how it was» |
| Migration | «Aggiornamento della struttura» | «Structure update» |
| Framework version | «Versione» (solo in una nota) | «Version» (only in a note) |
| Update | «Aggiornamento disponibile» | «Update available» |
| Manifest | Non visibile | Not visible |
| Template | Non visibile | Not visible |
| Configuration | «Impostazioni della campagna» | «Campaign settings» |
| Customizations | «Le tue regole» | «Your rules» |
| Hook | «Controllo automatico» | «Automatic check» |
| Deterministic script | Non visibile | Not visible |
| Test case | Non visibile | Not visible |
| Continuity audit | «Controllo di coerenza» | «Consistency check» |
| Linker | «Collegamenti» | «Links» |
| Character sheet manager | «Schede dei personaggi» | «Character sheets» |
| Canon research | «Che cosa dice la campagna» | «What the campaign says» |
| Combat tracker | «Scontro» | «Combat» |
| Session log | «Registro della partita» | «Game log» |
| Derived index | «Mappa» o «Enciclopedia» | «Map» or «Encyclopedia» |
| Subject index | Non visibile | Not visible |
| Aliases | «Altri nomi» | «Other names» |
| Plot map | «Mappa della trama» | «Plot map» |
| Metadata | «Dati della scheda» (solo nei documenti) | «Card data» (only in documents) |
| Markdown | «Scheda» o «documento» | «Card» or «document» |
| Master block | «Note del master» | «Master's notes» |
| Anchor | Non visibile (il rimando funziona) | Not visible (the link works) |
| Working state | «Appunti della partita» | «Game notes» |
| Live session | «Partita in corso» | «Game in progress» |
| Working session | «Conversazione» | «Conversation» |
| Work note (what is in progress) | «Il lavoro in corso» | «Work in progress» |
| Session document | «Sessione» | «Session» |
| Event (plot event file) | «Scena» | «Scene» |
| Session map (main file of a session) | «Mappa della sessione» | «Session map» |
| Print status | «Da stampare», «Stampata», «Da ristampare» | «To print», «Printed», «To reprint» |
| Free canvas | «Tela libera» | «Free canvas» |
| Master screen | «Schermo del master» | «Master screen» |
| PSD | «File di lavoro del disegno» | «Working drawing file» |
| PNG | «Immagine» | «Image» |
| JSON, YAML | «Dati» | «Data» |
| Sources folder / acquisition card | «Fonti» | «Sources» |
| Ingest | «Portare nella campagna» | «Bring into the campaign» |
| Image provider | «Servizio per le illustrazioni» | «Illustration service» |
| API key | «Chiave del servizio» | «Service key» |

## Never say

Never write these words, in any language, in a message to the master or in a document meant for players: skill, script, git, commit, repository, YAML, frontmatter, metadata block, Markdown, sub-agent, model, Haiku, Claude, hook, MCP, template, prompt, JSON, plugin, draft, batch, provenance field, codes of saved versions (for example a1b2c3d), text in backticks, and the names of terminal commands (for example `node`, `mkdir`, `git`, `cat`).

## Where a document comes from

Use these words when you tell the master where something comes from. They are not internal terms.

| Internal term (never say it) | Italian word the master sees | English word the master sees |
|---|---|---|
| Provenance master | «Detto da te» | «Said by you» |
| Provenance played | «Giocato al tavolo» | «Played at the table» |
| Provenance generated | «Inventato dall'assistente» | «Invented by the assistant» |

## Fixed sentences for images

Use these sentences as they are when the image tool needs them. The label in brackets is how the instructions of the images skill name each sentence. The master never hears the name of a service, except in the consent sentence.

| Label | Italian | English |
|---|---|---|
| [no service] | Nessun servizio per le illustrazioni è disponibile in questo momento. Se hai un'immagine tua, mandamela e la collego alla scheda. | No illustration service is available right now. If you have an image of your own, send it to me and I will attach it to the sheet. |
| [requested service unavailable] | Il servizio per le illustrazioni che hai chiesto non è disponibile in questo momento. Vuoi che ne usi un altro? | The illustration service you asked for is not available right now. Do you want me to use another one? |
| [consent] | Per creare l'immagine userò <servizio>, un servizio esterno: riceverà solo la descrizione pubblica di «<titolo>», mai le tue note riservate. Va bene? | To create the image I will use <service>, an outside service: it will receive only the public description of «<title>», never your private notes. Is that all right? |
| [reserved document] | Questo documento è riservato a te, quindi non lo mando a nessun servizio per le illustrazioni. | This document is for your eyes only, so I will not send it to any illustration service. |
| [send your own image] | Non ho un servizio per le illustrazioni disponibile: mandami un'immagine tua e la collego alla scheda. | I have no illustration service available: send me an image of your own and I will attach it to the sheet. |
| [key needed] | Per usare <servizio> mi serve la sua chiave. Me la incolli qui? La tengo solo su questo computer, fuori dalla campagna. | To use <service> I need its key. Can you paste it here? I keep it only on this computer, outside the campaign. |
| [map tools unavailable] | Non riesco a preparare gli strumenti per le mappe su questo computer. Posso comunque creare un'illustrazione del luogo vista dall'alto, senza griglia: vuoi? | I cannot set up the map tools on this computer. I can still create an illustration of the place seen from above, without a grid: would you like that? |
| [world map not available] | Per ora so fare mappe di un luogo, come una stanza, un edificio o una strada, ma non la carta di tutto il mondo o di una regione. | For now I can make maps of one place, such as a room, a building or a street, but not a chart of the whole world or of a region. |

## Fixed sentences for artwork search

Use these sentences as they are when the artwork tool needs them. The label in brackets is how the instructions of the artwork search skill name each sentence. The master never hears the name of a site or of a service.

| Label | Italian | English |
|---|---|---|
| [artwork consent] | Per cercare l'immagine userò la ricerca sul web. Cercherò solo parole generiche sull'aspetto, mai nomi, luoghi o le tue note riservate. Va bene? | To find the picture I will search the web. I will search only generic words about how it looks, never names, places or your private notes. Is that all right? |
| [artwork nothing found] | Non ho trovato nessuna immagine fatta da un artista che vada bene per questo. Posso crearne una con l'intelligenza artificiale, ma solo se me lo chiedi: vuoi? | I found no picture made by an artist that fits this. I can create one with artificial intelligence, but only if you ask me to: do you want that? |
| [artwork license free] | Autore: <autore>. Licenza: <licenza>, una licenza libera. | Author: <author>. License: <license>, a free license. |
| [artwork license private use] | Autore: <autore>. Licenza: <licenza>. Solo uso privato al tavolo, non per pubblicare. | Author: <author>. License: <license>. Private use at the table, not for publishing. |
| [artwork no background provider] | Non ho un servizio che tolga lo sfondo su questo computer. Posso mostrarti le immagini con il loro sfondo, se vuoi. | I have no service that can remove the background on this computer. I can show you the pictures with their background, if you want. |
| [artwork proposal intro] | Ho trovato queste immagini. Quale vuoi usare? Rispondi con il numero, o scrivi «nessuna». | I found these pictures. Which one do you want to use? Answer with the number, or write «none». |
| [artwork applied] | Ho aggiunto l'immagine alla scheda di <scheda>, di <autore>. | I added the picture to the sheet of <sheet>, by <author>. |

## Other languages

For a campaign language other than Italian or English, translate the English column faithfully and keep using the same word every time.

## Fixed sentences for failures

When something fails, use the row that matches: an operation that could not be finished; a check that found a problem with a link; a problem in the campaign settings; a first document that could not be completed; an earlier update that was not finished; an update that could not be applied. Use these sentences as they are.

| Italian | English |
|---|---|
| Non sono riuscito a completare questa operazione. Non è stato perso nulla: possiamo riprovare. | I could not complete this operation. Nothing was lost: we can try again. |
| Un controllo ha trovato un problema in un collegamento; per ora resta aperto. | A check found a problem with a link; it is still open for now. |
| Le impostazioni della campagna hanno un problema. Posso provare a sistemarlo, vuoi? | The campaign settings have a problem. I can try to fix it, do you want me to? |
| Il primo documento non è stato completato, ma le impostazioni sono pronte. | The first document could not be completed, but the settings are ready. |
| Un aggiornamento precedente non è stato terminato. | An earlier update was not finished. |
| Non sono riuscito ad applicare questo aggiornamento. Non è stato cambiato nulla. | I could not apply this update. Nothing was changed. |

## Fixed sentence for a finished update

Use this sentence as it is when the assistant has been updated. It is not a failure.

| Italian | English |
|---|---|
| L'assistente è stato aggiornato. Nulla di tuo è cambiato. | The assistant has been brought up to date. Nothing of yours has changed. |

## Fixed sentence for a session already played

Use this sentence as it is when the master asks to change a session that has already been played. It is not a failure, and nothing was changed.

| Italian | English |
|---|---|
| Questa sessione è già stata giocata, quindi non posso più cambiarla. Posso preparare la prossima, se vuoi. | This session has already been played, so I can no longer change it. I can prepare the next one, if you want. |

