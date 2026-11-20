---
name: issues
description: Development-repo skill (not part of the Yllir framework). Manages the GitHub issues of Yllir on StefanoVe/yllir - lists and triages them, checks whether one is already fixed, resolves one through the repo's normal development flow, writes comments and changes state (close, reopen, labels). Use when the author mentions an issue ("issue #3", "risolvi la issue", "commenta la issue", "chiudi la issue", "quali issue sono aperte").
---

# Issues

## Fixed facts
- Repository: pass `--repo StefanoVe/yllir` to every gh command. The local remote of yllir-development redirects there; it is also `REPO` in `yllir/scripts/lib/issue-report.mjs`.
- Issues filed by the framework have the sections Summary, Steps, Expected, Actual and Environment (with the framework version), and a footer saying they were reported on behalf of a game master.
- Issues, comments and commit messages are in English. Replies to the author follow CLAUDE.md "How to answer the author" (TLDR, Italian).
- The assistant never pushes commits (CLAUDE.md "Versioning and commits"). This drives every state change below.

## Outward-facing rule
Every comment, close, reopen and label change is public. Before each one:
1. Write the body to a file in `.claude/scratchpad/`, for example `.claude/scratchpad/issue-<N>-comment.md`.
2. Show the author the exact text and the exact action.
3. Act only after a yes.

Post with `--body-file` reading that file, never inline. Never put campaign content, master-only notes, home-folder paths or personal data in a comment. Use only labels that already exist (`gh label list --repo StefanoVe/yllir`). Creating a label is the author's decision: ask.

## 1. List and triage
- List: `gh issue list --repo StefanoVe/yllir --state open --json number,title,labels,createdAt`
- Read each one: `gh issue view <N> --repo StefanoVe/yllir --json title,body,labels,comments`
- Already fixed? Search the history for the subject, starting from the day before the issue was created (on macOS: `date -j -v-1d -f %Y-%m-%d <YYYY-MM-DD> +%F`):
  - `git log --oneline --since=<SINCE> -i -E --grep='<kw1>|<kw2>'`
  - `git log --oneline --grep="#<N>"`
  - Keywords come from the title, for example `icon|marker` for a marker-icon issue, `endless|sea` for a sea-texture issue.
- A commit counts as a fix only if its subject names the feature asked for and its version is later than the "Framework version" in the issue's Environment section. If the windowed search finds nothing that clearly fits, repeat the same grep without `--since` and apply the version test to each hit.
- Present one line per issue to the author: number, title, state guess (already fixed in `<hash>` / to fix / needs info), proposed action. Ask which ones to handle.

## 2. Resolve one issue
1. Read the issue and its comments. If Steps or Expected are missing or ambiguous, propose a comment asking for them instead of guessing.
2. Turn Steps and Expected into a failing test next to the touched script, and run it with `node --test` before the fix.
3. Do the fix through the flow in CLAUDE.md "How to develop in this repo" (briefs to executor sub-agents, review, tests) and "Versioning and commits" (version bump, news file, commit). Do not restate or override those rules here.
4. Add a final line `Fixes #<N>` to the commit message body, before the attribution line. GitHub closes the issue when the author pushes.
5. After the commit, propose the comment for the "fixed locally" case in section 3.

## 3. Comments and state changes
First decide where the fix is: run `git fetch origin`, then `git merge-base --is-ancestor <hash> origin/main` (exit 0 means already published).

- **Fixed and published:** comment "Fixed in <short hash> (version <X.Y.Z>): <one sentence on what changes>.", then close it. Post the comment first with `gh issue comment <N> --repo StefanoVe/yllir --body-file <file>`, then run `gh issue close <N> --repo StefanoVe/yllir --reason completed`.
- **Fixed locally, not pushed:** do NOT close. Comment only: "Fixed in version <X.Y.Z>, available with the next release." Tell the author the issue closes when they push, because of the `Fixes #<N>` line.
- **Not planned or duplicate:** comment with the reason (for a duplicate, the number of the other issue). Then `gh issue close <N> --repo StefanoVe/yllir --reason "not planned"` or `--reason duplicate`.
- **Needs info:** comment with the precise questions and leave the issue open. Add the label `question` only if the author agrees.
- **Reopen:** post the reason with `gh issue comment` first, then `gh issue reopen <N> --repo StefanoVe/yllir`.
- **Labels:** `gh issue edit <N> --repo StefanoVe/yllir --add-label <label>` or `--remove-label <label>`.

Valid close reasons are exactly: `completed`, `not planned`, `duplicate`.

## 4. Report to the author
After each action, give one line: issue number, what was done (comment posted / closed as X / left open until the push), and the link printed by gh.
