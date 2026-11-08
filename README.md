# Yllir

A framework of agent skills for creating and maintaining tabletop RPG campaigns. It works with Claude Code and, optionally, Codex.

The game master talks in natural language. Git, sub-agents, independent reviews and linking all happen behind the scenes. Yllir is system-agnostic: D&D 2024 is only the first adapter.

## Repository layout

- `yllir/`: the framework itself, in its distributable form (a plugin for Claude Code and Codex).
- `testbench/`: synthetic test campaigns, runners and answer keys that exercise the framework. See [testbench/README.md](testbench/README.md).
- `docs/`: project scope and the author's decisions, in Italian. Start from `docs/Framework per campagne di GDR.md`.

## How the framework is built

Three layers. Dependencies point downward only.

- **Core processes** (what the master experiences):
  - `yllir`: the entry point. It recognises what the master wants and runs the right process.
  - `new-campaign`: creates a campaign in an empty folder with a short interview.
  - `prepare-session`: drafts the next session as a plot document.
  - `after-session`: records a session that was played as a chronicle page.
  - `write-sequence`: the only way campaign documents are written (continuity check, independent review, write, links, verification, saved version).
- **Library skills**, called by core and never by the user:
  - `linker`: links every mention of a subject.
  - `continuity-audit`: finds contradictions.
- **Optional modules**: system adapters, style profiles, outputs (not implemented yet).

Each skill keeps its deterministic Node.js scripts (`.mjs`) in its own folder, for example `yllir/skills/library/linker/scripts/`. Code shared by several skills is in `yllir/scripts/`. Agent instructions for a campaign are generated from `yllir/templates/` and the campaign's `campaign.yaml`.

Sub-agent definitions (process runner, canon reviewer, linker reviewer, audit extractor, judge and coverage reviewer) are in `yllir/agents/`.

## Requirements

- Node.js 20 or later.
- Git. Campaigns are always git repositories, and the framework does not write without git.
- Claude Code, or Codex (plugin manifests in `yllir/.claude-plugin/` and `yllir/.codex-plugin/`).

## Development

Run the unit tests of the framework:

```sh
cd yllir
npm test
```

Implementations are orchestrated through cheap sub-agents (Haiku, Luna) under a supervising agent, as described in `CLAUDE.md`. For the end-to-end cases, see [testbench/README.md](testbench/README.md).

## Status

Early development. The core processes above exist and are covered by unit tests and testbench cases. Modules, system adapters and the installer for non-technical users are still at the specification stage.

## License

See [LICENSE](LICENSE).
