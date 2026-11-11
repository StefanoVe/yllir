# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Yllir is a framework of agent skills, distributed as a Claude Code plugin (Codex at most as an optional image provider), for creating and maintaining tabletop RPG campaigns. It is system-agnostic: D&D 2024 is only the first adapter. The target user is a game master who has never used AI or a terminal: they talk in natural language, and everything else (git, sub-agents, reviews, linking) stays hidden.

**Current state: specification only.** No code, no build, no tests exist yet. `yllir/` and `testbench/` are empty.

## Repository layout

- `yllir/`: the framework itself, in its published, distributable form.
- `testbench/`: synthetic test campaigns that exercise every framework feature (linker, audit, ingest, migrations…).
- `docs/`: project scope, in Italian. Start from `docs/Framework per campagne di GDR.md`, which is the index and holds the **author's binding decisions**. Every other doc expands on them. Anything marked **Proposta** there is not approved yet, and each doc ends with its own open questions. Do not treat proposals as decisions, and do not silently resolve open questions: ask.

## Rules that cut across the spec

- **Language split.** Everything in `yllir/` (skills, instructions, code, internal names, framework docs) is in English. Campaigns, generated documents and messages to the master use the language set in the campaign config. The spec in `docs/` is in Italian, so keep editing it in Italian.
- **YAGNI and a single source of truth.** Each piece of information has one home, and everything else is derived and regenerable. Agent instructions are generated from templates plus `campaign.yaml`, not hand-written.
- **Three layers:** core processes (what the master experiences), library skills (called by core, never by the user), and optional modules (system adapters, style profiles, outputs). Dependencies point downward only, and core knows nothing about any specific world or game system. Write-time wiring (audit before a change, linking after it, plot-map update) lives in core and is not left for the agent to remember.
- **Deterministic scripts do the mechanics, the agent judges.** Mention finding, link checking, validation of the master-only block, and index regeneration go in Node.js scripts (`.mjs`). The known failure modes to design against are a linker that misses mentions and an audit that never reports anything (see `docs/Robustezza e test.md`).
- **Skill scripts live with their skill.** A script that a skill runs lives in the same folder as that skill's `SKILL.md` (for example `yllir/skills/library/linker/`), not in a shared `scripts/` folder. Only code used by several skills or by the framework itself stays outside a skill folder.
- **Creative writing is the main agent's; cheap models get precise orders.** Since the 2026-11-11 redesign (`docs/Riprogettazione.md`), the high-level main agent writes world, sheets and scenes; cheap models (Haiku) execute bounded orders from it. Deterministic checks always run; a separate reviewer sub-agent runs only on batches that add facts to the canon. Orders to cheap executors must still be explicit enough for the weakest one.
- **Master-only notes.** The reserved block is visible to agents that work on the canon. It never goes to reviewers of player-facing text, image providers, web searches or publishing services.
- **Campaigns are always git repos.** Without git the framework does not write, and git history is the only backup. Migrations may touch user content only reversibly, and never the user's customizations.
- **Design from scratch.** Existing tools (including Baltimora, the author's Angular skill framework at work, which is the reference model for the layers and updates) are inspiration only. Do not copy code or inherit their structure.

## How to develop in this repo

Every implementation is orchestrated through sub-agents running Haiku or Luna. This is the same model the framework prescribes for itself (see `docs/Orchestrazione degli agenti.md`).

- **The main agent** breaks the work down, writes a self-contained brief for each piece (task, files to read, files it may write, what not to do, exit criteria), reviews what comes back, and decides. It does not write the implementation itself.
- **Executors** do the writing. Use the Agent tool with `model: "haiku"`. Luna is not available as a Claude Code sub-agent: use it only through Codex, when Codex is installed.
- **Sub-agents running in parallel** must never write the same file.
- **If a brief fails**, rewrite it to be more explicit and rerun it. Do not take the task over yourself. A brief that only works for a stronger model is a defect, so treat it like a failing test.
- **Codex implementation workflow.** Before each new implementation, Codex must prepare an explicit plan that breaks the work into tasks with completion criteria. It must launch executor sub-agents with `model: "gpt-6-luna"` explicitly, actively supervise their progress, review their results, and resolve blockers by refining briefs and relaunching Luna. Before finishing, Codex must verify that every plan item is complete. The main agent orchestrates this work and does not take over implementation.

## Versioning and commits (automatic)

Do this at the end of every task that changes files under `yllir/`, `testbench/` or `docs/`, without waiting to be asked. The user does not need to request it.

- **Version.** The framework version lives in `yllir/.claude-plugin/plugin.json` (field `version`). Bump it in the same commit as the change, using semver while on `0.x`:
  - **minor** (`0.8.0` → `0.9.0`) for a new or changed feature, skill, agent, script behavior or migration;
  - **patch** (`0.8.0` → `0.8.1`) for a fix, a wording change in instructions or a test-only change;
  - **no bump** when only `docs/`, `CLAUDE.md` or `testbench/` changed and `yllir/` is untouched. Never bump to `1.0.0` without the author's decision.
- **Commit.** After the work is reviewed and the tests pass (`node --test` on the touched scripts), make one commit on the current branch with the files of that task only (never `git add -A`; leave unrelated changes alone). If the tests fail, do not commit: report the failure.
- **Message.** Short, in English, imperative or descriptive, the same style as the history (for example `npc-manager`, `0.6.0 - linker and dependency update`). When the version was bumped, put the new number in the message (`<what changed>; version X.Y.Z`). End with the attribution line given by the session.
- **Limits.** Commit only, never push, never amend or rewrite history, never skip hooks. Pushing and tagging stay with the author.

## Test campaigns (testbench)

A test case is a campaign, a natural-language request and a verifiable `expected.yaml`/`key.yaml`. Keep the answer key **outside** the folder the agent under test can read: if the agent sees the key, the test measures copying, not finding. Fixtures must be synthetic, with no real campaign or specific game system in them, and contain seeded traps: homonyms, aliases, distant contradictions, hypotheses that must not become accusations, and recorded exclusions that must not be flagged. Each case runs several times per agent, and the result is a pass rate recorded with the model and a hash of the instructions.

The world-generation cases (`testbench/cases/world/`) are long and cost money: run them (`run-suite.mjs --with-world --only world/`) only when an implementation changes the generation path (build-world, write-document, the sheet-expander or batch-reviewer agents, `authoring.md`, the engine's context or commit, the adapter checks).

## Local working files

`.claude/memory/` (auto-memory, configured in `.claude/settings.local.json`) and `.claude/scratchpad/` are gitignored. Put temporary files in `.claude/scratchpad/`.
