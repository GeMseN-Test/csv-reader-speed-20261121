// csv-reader-speed: a faster drop-in replacement for csv-reader 1.0.0.
//
// Same answers, byte for byte, on every input: the same {columns, rows, errors}
// for the same {text, header}. One left-to-right scan, no regex in the hot loop,
// no per-character work on the common path, no object allocated per field.
//
// How it stays fast:
// - A record line with no quote and no CR is sliced once and split on ',' with
//   the native split — no per-field, per-character work.
// - An unquoted field ends at the first ',' or line break, found with indexOf;
//   the line's known end is reused instead of searching for the next line
//   break again on every field, and whether its line holds a CR is checked
//   once per line, not once per field. A stray CR is the only thing that
//   falls back to a short re-scan.
// - A quoted field jumps from quote to quote with indexOf; only the rare field
//   that holds a line break or a doubled quote builds its value piece by piece.
//
// Broken input is reproduced exactly: a lone CR outside quotes is dropped
// (stray_cr), characters after a closing quote are appended as they stand
// (quote_junk), a quote that never closes is a literal character and the text
// after it is read again as unquoted (unterminated_quote), short rows are
// padded (short_row) and long rows are cut (long_row), each error carrying the
// 1-based line its record starts on and its index in rows.

/** How a field ended: at a comma (the record goes on), at a line break or at the end of the text (the record ends). */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = n > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;
  // The last field read: its value, how it ended, and how many characters
  // were kept onto it. The field readers write these instead of allocating
  // a result object per field.
  let fv = '';
  let fe = END;
  let fa = 0;
  // Whether the line pos sits on is known to hold a CR, and whether it does.
  // An unquoted field on a CR-free line skips its CR scan entirely; the flag
  // is cleared whenever pos crosses a line break.
  let crKnown = false;
  let crLine = false;
  // The index of the '\n' ending the line pos sits on (-1: none), and whether
  // it is known. An unquoted field reuses it instead of searching for the
  // next line break on every field; it is cleared on crossing a line break.
  let le = -1;
  let leKnown = false;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // The value of text[a..b) with every CRLF or lone CR inside it read as one
  // LF, counting the lines it spans. A segment with no line break is one slice.
  function segmentValue(a, b) {
    const ni = text.indexOf('\n', a);
    if (ni !== -1 && ni < b) return normSeg(a, b);
    const ri = text.indexOf('\r', a);
    if (ri !== -1 && ri < b) return normSeg(a, b);
    return text.slice(a, b);
  }

  function normSeg(a, b) {
    let out = '';
    let s = a;
    while (s < b) {
      let ni = text.indexOf('\n', s);
      if (ni === -1 || ni >= b) ni = Infinity;
      let ri = text.indexOf('\r', s);
      if (ri === -1 || ri >= b) ri = Infinity;
      if (ni === Infinity && ri === Infinity) {
        out += text.slice(s, b);
        break;
      }
      if (ri < ni) {
        out += text.slice(s, ri);
        out += '\n';
        line += 1;
        s = ri + 1 < b && text.charCodeAt(ri + 1) === 10 ? ri + 2 : ri + 1;
      } else {
        out += text.slice(s, ni);
        out += '\n';
        line += 1;
        s = ni + 1;
      }
    }
    return out;
  }

  // Reads unquoted characters onto `value` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Writes the field to fv/fe
  // and the characters kept onto it to fa, so a caller can tell whether
  // anything was appended.
  function readUnquoted(value, added) {
    for (;;) {
      const ci = text.indexOf(',', pos);
      const ni = leKnown ? le : text.indexOf('\n', pos);
      if (!leKnown) {
        le = ni;
        leKnown = true;
      }
      let m;
      let kind;
      if (ci === -1) {
        m = ni;
        kind = LINE_BREAK;
      } else if (ni === -1) {
        m = ci;
        kind = COMMA;
      } else if (ci < ni) {
        m = ci;
        kind = COMMA;
      } else {
        m = ni;
        kind = LINE_BREAK;
      }
      if (!crKnown) {
        const e2 = ni === -1 ? n : ni;
        crLine = text.slice(pos, e2).indexOf('\r') !== -1;
        crKnown = true;
      }
      if (m === -1) {
        if (!crLine) {
          fv = value + text.slice(pos, n);
          fa = added + (n - pos);
          pos = n;
          fe = END;
          return;
        }
        const tail = text.slice(pos, n);
        const ri = tail.indexOf('\r');
        if (ri === -1) {
          fv = value + tail;
          fa = added + tail.length;
          pos = n;
          fe = END;
          return;
        }
        error('stray_cr');
        value += tail.slice(0, ri);
        added += ri;
        pos += ri + 1;
        continue;
      }
      const seg = text.slice(pos, m);
      if (!crLine) {
        fv = value + seg;
        fa = added + seg.length;
        pos = m + 1;
        if (kind === COMMA) {
          fe = COMMA;
          return;
        }
        line += 1;
        fe = LINE_BREAK;
        return;
      }
      const ri = seg.indexOf('\r');
      if (ri === -1) {
        fv = value + seg;
        fa = added + seg.length;
        pos = m + 1;
        if (kind === COMMA) {
          fe = COMMA;
          return;
        }
        line += 1;
        fe = LINE_BREAK;
        return;
      }
      if (kind === LINE_BREAK && ri === seg.length - 1) {
        fv = value + seg.slice(0, -1);
        fa = added + seg.length - 1;
        pos = m + 1;
        line += 1;
        fe = LINE_BREAK;
        return;
      }
      error('stray_cr');
      value += seg.slice(0, ri);
      added += ri;
      pos += ri + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Writes the field to
  // fv/fe (fa is 0 unless the field ends in junk).
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let value = null;
    let segStart = pos;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        readUnquoted('"', 0);
        return;
      }
      if (text.charCodeAt(q + 1) === 34) {
        const seg = segmentValue(segStart, q);
        value = value === null ? seg + '"' : value + seg + '"';
        pos = q + 2;
        segStart = pos;
        continue;
      }
      const seg = segmentValue(segStart, q);
      value = value === null ? seg : value + seg;
      pos = q + 1;
      break;
    }
    if (line !== openLine) {
      crKnown = false;
      leKnown = false;
    }
    if (pos >= n) {
      fv = value;
      fa = 0;
      fe = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fv = value;
      fa = 0;
      fe = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fv = value;
      fa = 0;
      fe = LINE_BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fv = value;
      fa = 0;
      fe = LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    if (line !== openLine) {
      crKnown = false;
      leKnown = false;
    }
    readUnquoted(value, 0);
    if (fa > 0) error('quote_junk');
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    crKnown = false;
    leKnown = false;

    // Fast path: the record's line holds no quote and no CR, so every field
    // is unquoted and the line splits on ',' alone.
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? n : nl;
    le = nl;
    leKnown = true;
    let segEnd = end;
    if (nl !== -1 && end > pos && text.charCodeAt(end - 1) === 13) segEnd = end - 1;
    let fields = null;
    let lastQuoted = false;
    let advanced = false;
    if (segEnd > pos) {
      const qi = text.indexOf('"', pos);
      if (qi === -1 || qi >= end) {
        const lineStr = text.slice(pos, segEnd);
        if (lineStr.indexOf('\r') === -1) {
          fields = lineStr.split(',');
          advanced = true;
        }
      }
    }
    if (advanced) {
      if (nl === -1) {
        pos = n;
      } else {
        pos = nl + 1;
        line += 1;
      }
    }
    if (fields === null) {
      fields = [];
      let ended;
      do {
        lastQuoted = text.charCodeAt(pos) === 34;
        if (lastQuoted) readQuoted();
        else readUnquoted('', 0);
        fields.push(fv);
        ended = fe;
        if (ended === LINE_BREAK) {
          crKnown = false;
          leKnown = false;
        }
      } while (ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
