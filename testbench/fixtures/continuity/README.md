# Continuity fixture

Synthetic test campaign for the library skill `continuity-keeper` (rename, delete, merge, retcon). All names are invented, the campaign is in Italian, and no real campaign or game system is used.

- `campaign/` is the only folder the agent under test may read. It is a small campaign: `campaign.yaml`, a seed and Markdown sheets. The runner copies it into a temporary git repository, saves one baseline version and gives the copy to the agent.
- The answer keys (`cases/continuity/<name>/key.yaml`) sit beside each `case.yaml`, outside this folder.
- Seeded traps, one group per case:
  - rename: a homonym (`Ilde Varno` shares the surname of `Corrado Varno`), an alias (`Corrado`), an unlinked mention of the old name in a chronicle, and a link in a plot document that must be retargeted.
  - delete: a plot document that names the merchant in a frontmatter field (`merchant`) and also links to him.
  - merge: a second sheet of the same person with a different birthplace (the one fact that must be asked), and a sister with a similar name (`Brizia Fell`) who must not be merged.
  - retcon: a chronicle page already played (`played: [sessione-2]`) that states the old date, and a recorded exclusion in `campaign.yaml` (the lighthouse height) that must not be touched.
- This README stays outside `campaign/`.
