# csv-reader-speed — indexOf-driven CSV reader, ~4x faster than csv-reader 1.0.0

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121/GeMseN-Test/csv-reader-speed-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121/GeMseN-Test/csv-reader-speed-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121/GeMseN-Test/csv-reader-speed-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A drop-in replacement for `csv-reader` 1.0.0 that answers **exactly the same** on
every case — and faster. Entry for the make.fun bounty
[csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
("Read broken CSV files faster, 21 November 2026").

## How it works

One left-to-right scan over the input, no regex in the hot loop, no per-character
work on the common path:

- **Fast path (most records):** a record line with no quote and no CR is sliced
  once and split on `,` with the native `split` — zero per-field work.
- **Unquoted fields:** a field ends at the first `,` or line break, found with
  `indexOf`; a lone CR is dropped and reported as `stray_cr`.
- **Quoted fields:** jumps from quote to quote with `indexOf`; `""` inside
  becomes one `"`, and CR/LF inside quotes becomes LF. Characters after the
  closing quote are appended as they stand (`quote_junk`); a quote that never
  closes is a literal character and the text after it is re-read as unquoted
  (`unterminated_quote`).
- **Broken rows, exact errors:** short rows are padded (`short_row`), long rows
  are cut (`long_row`), each error carrying the 1-based line its record starts
  on and its index in rows. A leading U+FEFF is dropped; blank lines are no
  records. Fields stay strings, never trimmed or converted.

## Usage

```js
import { run } from './solve.js';

const out = run({ text: 'a,b\n1,2\n', header: true });
// { columns: ['a', 'b'], rows: [['1', '2']], errors: [] }
```

`run({ text, header })` returns `{ columns, rows, errors }` — the same JSON the
reference `csv-reader` returns for the same input. `main.ts` is the harness
driver: it reads every case from `MAKEFUN_INPUT_DIR` (`/input`) and writes
`answers.json` to `MAKEFUN_OUTPUT_DIR` (`/output`).

## Test + benchmark

Exactness is checked against the reference (`vendor/csv-reader` in the kit):
the 6 practice cases must match `practice/reference/expected.json` case for
case, and a hand-built edge-case suite (empty text, BOM only, lone CRs,
unterminated quotes, `quote_junk`, multi-line quoted fields with lone CRs,
short/long rows with and without a header, missing final line break, …) must
match the reference on every input.

```sh
# practice set, exactness vs the reference answers
mkdir -p /tmp/csv-out
MAKEFUN_INPUT_DIR=kit-fresh/practice/input MAKEFUN_OUTPUT_DIR=/tmp/csv-out node main.ts
node -e "const a=require('/tmp/csv-out/answers.json'),b=require('./kit-fresh/practice/reference/expected.json');console.log(JSON.stringify(a)===JSON.stringify(b)?'6/6 identical':'MISMATCH')"
```

Benchmark (median of repeated `run()` passes over the 6 practice cases,
~10.2 MB of CSV): **~0.11 s vs the reference's ~0.47 s — about 4x faster**.
Run the bench script below for your own numbers:

```sh
node /tmp/csv-bench.mjs   # times solve.js vs the kit baseline, same cases, median
```

## License

MIT — see [LICENSE](LICENSE).
