import { requireValue } from './errors.mjs';
export function parseCSV(source) {
  const input = source.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, afterQuote = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; afterQuote = true; }
      else field += c;
    } else if (c === '"') { requireValue(!field && !afterQuote, 'Invalid quote in CSV.'); quoted = true; }
    else if (c === ',') { row.push(field); field = ''; afterQuote = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field); if (row.some(v => v.trim())) rows.push(row);
      row = []; field = ''; afterQuote = false;
    } else { requireValue(!afterQuote || /\s/.test(c), 'Unexpected character after quoted CSV value.'); if (!afterQuote) field += c; }
  }
  requireValue(!quoted, 'A quoted CSV value was not closed.');
  row.push(field); if (row.some(v => v.trim())) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map(h => h.trim());
  requireValue(headers.every(Boolean) && new Set(headers).size === headers.length, 'CSV headers must be nonempty and unique.');
  return rows.map((values,i) => {
    requireValue(values.length === headers.length, `CSV row ${i + 2} has ${values.length} columns; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((h,j) => [h,values[j].trim()]));
  });
}
