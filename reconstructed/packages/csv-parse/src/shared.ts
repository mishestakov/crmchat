export function transformHeader(h: string): string {
  const trimmed = h.trim();
  // Strip matching surrounding quotes (e.g. 'name' or "name"), but not mismatched ones
  const match = trimmed.match(/^(['"])(.*)\1$/s);
  return match ? match[2]!.trim() : trimmed;
}

/**
 * Split a CSV line into fields respecting double-quoted values (RFC 4180).
 * Returns the number of times `delimiter` appears **outside** quotes.
 */
function countUnquotedDelimiters(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && ch === delimiter) {
      count++;
    }
  }
  return count;
}

/**
 * Auto-detect the delimiter of a CSV string.
 *
 * Algorithm (inspired by Python's csv.Sniffer):
 * 1. Strip BOM, take up to 5 non-empty rows.
 * 2. For each candidate delimiter, count occurrences outside quoted fields per row.
 * 3. A candidate is "consistent" if every sampled row has the same non-zero count.
 * 4. Among consistent candidates, pick the one with the highest per-row count.
 * 5. If no candidate is consistent, fall back to the highest total count across rows.
 * 6. Default to comma if everything is zero/tied.
 */
export function detectDelimiter(csv: string): string {
  let text = csv;
  if (text.startsWith("\uFEFF")) text = text.slice(1);

  // Collect up to 5 non-empty lines
  const allLines = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const l of allLines) {
    if (l.trim() !== "") lines.push(l);
    if (lines.length >= 5) break;
  }

  if (lines.length === 0) return ",";

  const candidates = ["\t", ";", ","] as const;

  // For each candidate, get per-row counts
  const stats = candidates.map((delim) => {
    const counts = lines.map((line) => countUnquotedDelimiters(line, delim));
    const first = counts[0]!;
    const consistent = first > 0 && counts.every((c) => c === first);
    const total = counts.reduce((a, b) => a + b, 0);
    return { delim, counts, consistent, perRow: first, total };
  });

  // Prefer consistent candidates (same non-zero count on every row)
  const consistent = stats.filter((s) => s.consistent);
  if (consistent.length > 0) {
    // Pick highest per-row count; on tie, stable sort preserves order from candidates array [\t, ;, ,] so comma wins
    consistent.sort((a, b) => a.perRow - b.perRow);
    return consistent.at(-1)!.delim;
  }

  // Fallback: highest total, preferring comma on tie
  stats.sort((a, b) => a.total - b.total);
  const best = stats.at(-1)!;
  if (best.total === 0) return ",";
  return best.delim;
}

export const BASE_OPTIONS = {
  bom: true,
  skip_empty_lines: true,
  trim: true,
  relax_column_count: true,
} as const;
