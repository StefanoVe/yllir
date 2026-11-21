# import-interrupted-input

Input of the `import/interrupted` case (see `testbench/cases/import/interrupted`).

- `import-interrupted-input/` holds ONLY `note-locanda.md`, a synthetic Italian note about an invented inn.
  The runner copies this folder and adds `mappa-del-porto.pdf` to the copy at setup. That PDF is built by
  `makeTruncatedPdf()` in `runners/run-import-case.mjs`: a valid one-page PDF cut after 45% of its bytes,
  so it cannot be opened. It is not stored in the repository.
- The words `Salvena` and `molo nord` exist only in the cut-away part of that PDF. No campaign document may
  contain them after the run (check I6).
- The note holds one master-only line (`Segreto del master: ...`). The import is not asked to hide it, only
  to keep the original and to transcribe it faithfully.
- The game system is not named anywhere: the case tests the import, not a rules adapter.
