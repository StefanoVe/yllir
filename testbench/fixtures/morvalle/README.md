# Morvalle fixture

Synthetic test campaign for the linker (mention finding) and the continuity audit. The campaign is written in Italian. All names are invented, and no real campaign or game system is used.

- `campaign/` is the only folder the agent under test may read. It is a small campaign: `campaign.yaml` plus Markdown sheets.
- `key.yaml` is the answer key: mentions to link or not, contradictions to report, and non-issues that must not be reported. It must never be copied next to `campaign/` or into any folder the agent can read.
- Seeded traps: homonyms (Oria Valdes / Oria Brunel), an alias (Mastro Teodo), a missing accent, a plain vs typographic apostrophe, figure-through relations, a hypothesis that must not become an accusation, and a recorded perspective difference.
- This README stays outside `campaign/`.
