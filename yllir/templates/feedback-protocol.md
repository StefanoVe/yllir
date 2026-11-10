# Per-skill feedback protocol

This protocol records every Yllir skill use locally. The runtime hook set does not expose individual skill start/end events, so these records are caller-written; never claim hook-based skill coverage. The `yllir` entry point records its own lifecycle. The process runner records the PROCESS skill it invokes. Each other caller records only the child skill it invokes; do not create a second record for an invocation already owned by its caller or runner. When launching any sub-agent, pass the current id as `FEEDBACK_PARENT` and include this protocol in its instructions if it may invoke a Yllir skill.

Before invoking a skill or reading its `SKILL.md` as a substitute for invocation, assign a unique invocation id (for example `s-<timestamp>-<counter>`) and run:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/feedback.mjs" record skill-start . --invocation <id> --parent <parent-id-or-none> --skill <skill-name> --model <model-name-or-unknown> --input "<short purpose, no campaign detail>"
```

After it returns, including when it fails, asks a question, or is stopped, preserve its available input and result in a temporary JSON file under `.campaign/state/feedback/` (for example `pending-<id>.json`). Use the Write tool, not shell redirection. The JSON object has `skill`, `input`, `output`, `status`, and `steps`. Include exact observable tool calls and results, decisions, retries, and review outcomes in `steps` when available. Mark unavailable portions explicitly; do not fabricate details or include hidden reasoning. These are the caller's observable records, not guaranteed complete runtime dumps.

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/feedback.mjs" record skill-end . --invocation <id> --parent <parent-id-or-none> --skill <skill-name> --model <model-name-or-unknown> --status <ok|partial|failed|blocked|question> --artifacts "<comma-separated paths or none>" --issues "<brief issues or none>" --transcript <transcript-path>
```

If no usable input/output transcript is available, omit `--transcript` and pass `--transcript-status unavailable`. Use the model name from the current runtime context; if it is not available, record `unknown` and never guess. Do this in a finally-style step; a failed invocation still needs its end record. If a caller starts a child skill, pass its own invocation id as `--parent`. Record each retry as a new invocation with the same parent. Feedback commands are best-effort and are exempt from ordinary command-refusal/failure handling: do not retry a refused feedback command, fail the skill because of it, or mention it to the master. Continue the requested work and mark missing records unavailable; never claim they were recorded.

Full transcripts, artifacts, issues and detailed local reports can contain campaign text, including master-only notes. They stay in the campaign's local feedback state. The normal export is an aggregate metadata allowlist and omits transcript bodies, paths, artifacts, issues, input and free-text notes. No feedback command sends data over a network.

Local report:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/feedback.mjs" report .
node "${CLAUDE_PLUGIN_ROOT}/scripts/feedback.mjs" report . --include-transcripts yes
```

The first command includes detailed invocation records but not transcript bodies. The second reads transcript bodies from local storage. The `--include-transcripts` mode is local inspection only and is not an export mode. `export --out <file>` keeps the existing aggregate export; `export --out <file> --include-details yes` also includes per-skill identifiers, parent, model, outcome and transcript availability. Both export modes omit transcript bodies, inputs, issues, artifacts and the active topic because those can contain campaign or master-only text.
