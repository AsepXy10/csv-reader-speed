// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// run(input) returns exactly {columns, rows, errors} as csv-reader 1.0.0
// does, for every input. The semantics are csv-reader's own broken-row
// policy (see the competition brief): BOM dropped, records end at LF or
// CRLF, blank lines are no records, stray CRs, unterminated quotes,
// quote junk, and short/long rows are all reported with {code, line, row}.
//
// Speed: most records are plain lines with no quotes and no stray CRs.
// Those take a fast path -- one indexOf for the line end, a slice, two
// bounded indexOf checks, and String.split(','). Anything with a quote or
// a stray CR takes a slow path that mirrors csv-reader's semantics exactly,
// but builds fields from spans (slice) instead of one character at a time.
//
// No state is kept between calls; each case is answered alone.

const COMMA = 0;
const BREAK = 1;
const END = 2;

/**
 * Parse one record starting at `pos` (quote-aware). Returns
 * {fields, pos, line, skip}: the fields, the position and line after the
 * record, and whether the "record" was a line holding only stray CRs (no
 * record at all, though its stray_cr errors stay). Field errors are pushed
 * onto `errors` in the order met; the record's short_row/long_row error is
 * left to the caller, as in csv-reader.
 */
function slowRecord(text, len, pos, line, recordLine, recordRow, errors) {
  const fields = [];
  let quoted = false;

  function err(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Read unquoted characters from pos onto `init` up to the next comma or
  // line break; a CR not followed by LF is dropped (stray_cr). Returns
  // {value, end, added}: the field, how it ended (COMMA/BREAK/END), and how
  // many characters were kept beyond `init` (for quote_junk).
  function readUnquoted(init) {
    let value = init;
    let added = 0;
    let start = pos;
    let parts = null;
    let end = END;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        if (parts === null) value += text.slice(start, pos);
        else value = parts.join('') + text.slice(start, pos);
        added += pos - start;
        pos += 1;
        end = COMMA;
        break;
      }
      if (c === 10) {
        if (parts === null) value += text.slice(start, pos);
        else value = parts.join('') + text.slice(start, pos);
        added += pos - start;
        pos += 1;
        line += 1;
        end = BREAK;
        break;
      }
      if (c === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          if (parts === null) value += text.slice(start, pos);
          else value = parts.join('') + text.slice(start, pos);
          added += pos - start;
          pos += 2;
          line += 1;
          end = BREAK;
          break;
        }
        err('stray_cr');
        if (parts === null) parts = [value];
        parts.push(text.slice(start, pos));
        added += pos - start;
        pos += 1;
        start = pos;
        continue;
      }
      pos += 1;
    }
    if (end === END) {
      if (parts === null) value += text.slice(start, pos);
      else value = parts.join('') + text.slice(start, pos);
      added += pos - start;
    }
    return { value, end, added };
  }

  // Read a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let q = text.indexOf('"', open + 1);
    let doubled = false;
    while (q !== -1 && text.charCodeAt(q + 1) === 34) {
      doubled = true;
      q = text.indexOf('"', q + 2);
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      err('unterminated_quote');
      return readUnquoted('"');
    }
    const content = text.slice(open + 1, q);
    let value;
    if (!doubled && content.indexOf('\r') === -1) {
      value = content;
      let i = content.indexOf('\n');
      while (i !== -1) {
        line += 1;
        i = content.indexOf('\n', i + 1);
      }
    } else {
      // "" inside is one quote; each CRLF or lone CR inside is one LF.
      value = content.replace(/""/g, '"').replace(/\r\n?/g, '\n');
      let i = value.indexOf('\n');
      while (i !== -1) {
        line += 1;
        i = value.indexOf('\n', i + 1);
      }
    }
    pos = q + 1;
    if (pos >= len) return { value, end: END, added: 0 };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, end: COMMA, added: 0 };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, end: BREAK, added: 0 };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, end: BREAK, added: 0 };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) err('quote_junk');
    return junk;
  }

  // The record's fields, read one at a time. The common unquoted field is
  // read inline (no call, no return object, no `added` bookkeeping: only
  // quote junk needs that, and it goes through readUnquoted).
  let end;
  do {
    if (text.charCodeAt(pos) === 34) {
      quoted = true;
      const f = readQuoted();
      fields.push(f.value);
      end = f.end;
    } else {
      quoted = false;
      let start = pos;
      let parts = null;
      let value;
      end = END;
      while (pos < len) {
        const c = text.charCodeAt(pos);
        // Most characters are letters, digits or punctuation above ',': a
        // single range check skips them. Only characters at or below ','
        // can be a delimiter (',', LF, CR) or a literal low character.
        if (c >= 45) {
          pos += 1;
          continue;
        }
        if (c === 44) {
          value = parts === null ? text.slice(start, pos) : parts.join('') + text.slice(start, pos);
          pos += 1;
          end = COMMA;
          break;
        }
        if (c === 10) {
          value = parts === null ? text.slice(start, pos) : parts.join('') + text.slice(start, pos);
          pos += 1;
          line += 1;
          end = BREAK;
          break;
        }
        if (c === 13) {
          if (text.charCodeAt(pos + 1) === 10) {
            value = parts === null ? text.slice(start, pos) : parts.join('') + text.slice(start, pos);
            pos += 2;
            line += 1;
            end = BREAK;
            break;
          }
          err('stray_cr');
          if (parts === null) parts = [];
          parts.push(text.slice(start, pos));
          pos += 1;
          start = pos;
          continue;
        }
        pos += 1;
      }
      if (end === END) value = parts === null ? text.slice(start, pos) : parts.join('') + text.slice(start, pos);
      fields.push(value);
    }
  } while (end === COMMA);

  // A line that held only stray CRs is left with no characters: no record.
  const skip = fields.length === 1 && fields[0] === '' && !quoted;
  return { fields, pos, line, skip };
}

/** csv-reader 1.0.0's answer for one case's input: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const len = text.length;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  while (pos < len) {
    // Lines with no characters are no records.
    for (;;) {
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
    if (pos >= len) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    let fields = null;

    // Fast path: the record's first physical line holds no quote and no
    // stray CR, so it is one whole record of plain comma-separated fields.
    const nl = text.indexOf('\n', pos);
    if (nl !== -1) {
      let s = text.slice(pos, nl);
      if (s.charCodeAt(s.length - 1) === 13) s = s.slice(0, -1); // CRLF
      if (s.length !== 0 && s.indexOf('"') === -1 && s.indexOf('\r') === -1) {
        fields = s.split(',');
        pos = nl + 1;
        line += 1;
      }
    }

    if (fields === null) {
      const r = slowRecord(text, len, pos, line, recordLine, recordRow, errors);
      pos = r.pos;
      line = r.line;
      if (r.skip) continue;
      fields = r.fields;
    }

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

  return { columns: header ? columns ?? [] : null, rows, errors };
}
