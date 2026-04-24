// Минимальный CSV-парсер. Поддерживает: comma-делимитер, double-quoted ячейки
// (с эскейпом `""` внутри), CRLF/LF новые строки, обязательный header. Не
// поддерживает: multi-line quoted ячейки, кастомный делимитер. Достаточно для
// типичных экспортов из Excel/Sheets/CSV-генераторов.

export type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
};

export function parseCsv(text: string): ParsedCsv {
  // BOM от Excel — снимаем, чтобы первая колонка не называлась `﻿id`.
  const t = text.replace(/^﻿/, "");
  const lines = t.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseLine(lines[0]!);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]!);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    rows.push(row);
  }
  return { headers, rows };
}

function parseLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else if (c === ",") {
      cells.push(current);
      current = "";
    } else if (c === '"' && current.length === 0) {
      inQuotes = true;
    } else {
      current += c;
    }
  }
  cells.push(current);
  return cells;
}
