# csv-reader-speed — single-pass hand-scanned CSV reader

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121/GeMseN-Test/csv-reader-speed-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121/GeMseN-Test/csv-reader-speed-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121/GeMseN-Test/csv-reader-speed-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A drop-in replacement for `csv-reader` 1.0.0 that answers **exactly the same** on every
case — and faster. Entry for the make.fun bounty
[csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
("Read broken CSV files faster, 21 November 2026").

## How it works

One left-to-right scan over the input, no regex in the hot loop, no allocation per
field unless the field actually needs it:

- **Fast path:** a field with no quotes, no CR and no comma runs is copied by
  `slice` straight out of the input — zero per-character work.
- **Quoted fields:** a tiny state machine walks to the next non-doubled quote;
  `""` inside a quoted field becomes one `"`, and CR/LF inside quotes becomes LF.
- **Broken input, exact errors:** a lone CR outside quotes is dropped and reported
  as `stray_cr`; a quote that never closes, a quote in the middle of an unquoted
  field, and the other broken shapes the reference reports are all reproduced
  byte-for-byte, including the exact error list and positions.
- **BOM:** a leading U+FEFF is stripped before parsing.

## Usage

```js
const { readCsv } = require('./src/index.js');

const out = readCsv({ text: 'a,b\n1,2\n', header: true });
// { columns: ['a', 'b'], rows: [['1', '2']], errors: [] }
```

`readCsv({ text, header })` returns `{ columns, rows, errors }` — the same JSON the
reference `csv-reader` returns for the same input.

## Benchmark

```sh
npm run bench   # local benchmark vs the reference behaviour
npm test        # exactness suite against the reference cases
```

## License

MIT
