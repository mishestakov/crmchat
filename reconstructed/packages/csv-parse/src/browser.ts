import { parse } from "csv-parse/browser/esm";

import { asyncIterateParser } from "./iterate.js";
import { BASE_OPTIONS, detectDelimiter, transformHeader } from "./shared.js";

export { detectDelimiter, transformHeader } from "./shared.js";

export interface ParseCsvOptions {
  maxRows?: number;
  delimiter?: string;
}

export async function* parseCsv(
  csv: string,
  opts?: ParseCsvOptions
): AsyncGenerator<Record<string, string>> {
  if (opts?.maxRows === 0) return;

  const parser = parse(csv, {
    ...BASE_OPTIONS,
    columns: (header: string[]) => header.map(transformHeader),
    delimiter: opts?.delimiter ?? detectDelimiter(csv),
    ...(opts?.maxRows && { to: opts.maxRows }),
  });

  // csv-parse's browser polyfill Transform lacks destroy(), patch it to avoid
  // "listener must be a function" error from this.on("end", this.destroy)
  // See: https://github.com/adaltas/node-csv/issues/333
  if (!parser.destroy) parser.destroy = () => parser;

  yield* asyncIterateParser(parser);
}
