---
name: encyclopedia
description: Library skill. Builds or refreshes the public encyclopedia of the campaign, a local static site with one page per public entry, only when the encyclopedia module is on. Runs every pre-publish check before anything is replaced, and tells the master in plain words what was included, what was left out and why. Invoked by the entry skill when the master asks to build, refresh or preview the encyclopedia.
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/library/encyclopedia/scripts/encyclopedia.mjs" *), Read, Glob, Grep
---

# Encyclopedia

You build the public encyclopedia of the campaign. It is a set of static pages written under `.campaign/cache/encyclopedia/`, a derived folder that can always be rebuilt. It is never canon and it is never published: hosting is not configured, so the site stays local and the master screen previews it.

**Commands.** Run the command exactly as written, as one single command: nothing before it, nothing after it, no `;`, `&&`, `|`, `2>&1`, `echo`, `cat`, `mkdir` or `cd`. Run it from the campaign root, with `<root>` as the campaign folder. The script ends its output with `exit: <code>`.

**Rules.**
- Only when `modules.encyclopedia` is `true` in `campaign.yaml`. If it is off, say so plainly in the campaign language (for example: «L'enciclopedia non è attiva in questa campagna. Vuoi attivarla?») and stop. Turning the module on is a separate decision, asked for on its own.
- Never publish, upload, send or share anything. Hosting and domain are not decided. If the master asks to put the site online, say that publishing is not set up yet and that the site is local.
- The reserved block (`<!-- master -->` to the end of a file), the world seed, the sheets in master-only categories and the folders `Giocatori/`, `Players/`, `Fonti/`, `Sources/`, `Appunti/`, `Notes/` never leave the campaign. The script enforces it; never copy such text into a prompt, a reply or a file yourself.
- Never open, edit or delete files under `.campaign/cache/encyclopedia/` by hand. It is rebuilt by the script only.
- Never say to the master: script, command, check ids, JSON, exit codes, SHA, hashes, CSP, Web Crypto, PBKDF2, AES, the names of the internal folders, or the names of the checks.

## Steps

**Step 1: check the module.** Read `campaign.yaml` with the Read tool. If `modules.encyclopedia` is not `true`, follow the rule above and stop.

**Step 2: build.**
`node "${CLAUDE_PLUGIN_ROOT}/skills/library/encyclopedia/scripts/encyclopedia.mjs" build .`
Read the JSON and the final `exit:` line.

- `exit: 0`: the site was built. Go to Step 3.
- `exit: 1`: nothing was replaced. Go to Step 4.
- Any other code: say the fixed sentence «could not complete» and stop.

**Step 3: report a successful build** in the campaign language, in short plain sentences:
- how many entries are public (`entries`), and that the site is local: the master can open it with the preview in the master screen;
- what was left out, one line per reason, from `excluded` (see the reasons below), without the names of the hidden subjects. Hidden entries are listed by their category, never by their title;
- every warning as a plain sentence (for example «un'immagine non è stata copiata perché contiene dati nascosti»);
- the change summary from the check `change-summary`, in plain words (new, removed and changed entries, compared with the previous build).

**Step 4: report a refused build.** Nothing was replaced: the previous site, if any, is still there. Say which checks failed, one plain sentence each, and what the master can do. The failing checks mean:
- a reserved sentence, a hidden subject's title or a secret code reached the public text: «Una frase della parte pubblica riprende un testo riservato. Tolgila dalla parte pubblica o spostala nella parte riservata»;
- a picture carries hidden data (location, author): «Un'immagine contiene ancora dati nascosti. Esportala di nuovo senza quei dati»;
- a locked text has no code, or its code is too short: «Il testo protetto della scheda X non ha ancora un codice nella parte riservata. Lo aggiungo?» (ask, do not change it yourself unless the master gave the code);
- a key-like string was found in the text: say it is in the public text, and ask the master to remove it;
- the unlock test failed, or a link points to a reserved note: say the build was stopped to protect the reserved text and that the master should tell you which sheet to look at.
Ask one question at a time, and only if the master's answer decides the next step.

## Reasons for leaving things out (plain words)

- private folder, category kept for the master, world seed, documents of another campaign: never published;
- no metadata or no id: the sheet has no stable address yet;
- invalid id: an address must be lowercase letters, digits and hyphens;
- duplicate id: two sheets share an address; neither is published until one of them gets a new id;
- marked not public: the master chose to hide it;
- sketch: not ready to publish;
- draft: a draft folder or a draft mark;
- no public text: the sheet has only reserved text, so nothing goes out (title included);
- no public title: the public part has no first heading.

## Locked texts (Proposta, for the master's text)

A public part of a sheet may hold a text that opens only with a code:

```markdown
<!-- locked: diario -->
Il testo protetto, che il lettore vede solo dopo il codice.
<!-- /locked -->
```

The label (`diario` here) is a short lowercase name, unique within the sheet. The codes live ONLY in the reserved part of the same sheet, under the heading `### Codici` (it) or `### Codes` (en), as list items:

```markdown
<!-- master -->
## Master

### Codici

- diario: ascia-9
```

Rules: a code has at least 4 characters; a locked block with no code in its own sheet's reserved part stops the build; the text and the code never appear in any output (the text is stored encrypted and opens in the browser only with the typed code).

## Stable addresses

Each entry lives at `<base address>/e/<id>/`. The id is the sheet's metadata `id`, never the file name. An id listed in `merged_ids` of a surviving entry redirects to it. An id in the retired list with no survivor shows a plain «no longer available» page. The base address comes from `encyclopedia.base_url` in `campaign.yaml` (default `http://localhost/`); if the master wants a different address, tell them it is changed in the campaign settings through the assistant.
