# Read broken CSV files faster

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/AsepXy10/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/AsepXy10/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0, for the make.fun bounty
[Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121).
`run(input)` returns exactly `{columns, rows, errors}` as csv-reader 1.0.0 does
for every input — same broken-row policy (BOM, CRLF, stray CRs, unterminated
quotes, quote junk, short/long rows) — but much faster.

## How it is fast

Most records are plain lines with no quotes and no stray CRs. Those take a
fast path: one `indexOf` for the line end, a slice, two bounded `indexOf`
checks, and `String.split(',')`. Anything with a quote or a stray CR takes a
slow path that mirrors csv-reader's semantics exactly, but builds fields from
spans (`slice`) instead of one character at a time, finds closing quotes with
`indexOf`, and only builds error objects when an error actually occurs. No
state is kept between cases; V8's incremental marking is off, as the house
driver runs.

## Files

- `solve.js` — dependency-free ES module exporting `run(input)`.
- `main.ts` — the program the harness runs: reads `/input/cases.json`,
  answers each case with `run`, writes `/output/answers.json`.
- `package.json` — `{"type": "module"}` so `solve.js` loads as ESM.
- `LICENSE` — MIT.

## Verify

Run the kit local grader (from the kit directory, Docker unavailable so
`--driver process`):

```sh
node cli/makefun.mjs grade-local --kit . --bot <this repository> --driver process
```
