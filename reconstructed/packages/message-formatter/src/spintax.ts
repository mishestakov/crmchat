// Matches {... | ...} with at least one pipe, supporting nested {{var}} pairs
// \{(?!\{) - opening { not followed by { (avoids matching {{variables}})
import { getNonSecureSeededRandomNumber } from "@repo/core/utils";

// (?:[^{}]|\{\{[^}]*\}\})* - content: non-brace chars OR complete {{...}} pairs
const SPINTAX_CORE = String.raw`\{(?!\{)((?:[^{}]|\{\{[^}]*\}\})*\|(?:[^{}]|\{\{[^}]*\}\})*)\}`;

export const SPINTAX_REGEX = new RegExp(SPINTAX_CORE);
export const SPINTAX_REGEX_GLOBAL = new RegExp(SPINTAX_CORE, "g");
export const SPINTAX_EXACT_REGEX = new RegExp(`^${SPINTAX_CORE}$`);

/**
 * Process spintax syntax: {option1 | option2 | ...}
 * Randomly selects one of the provided options.
 * Supports nested variables like: {Hi {{firstName}} | Hello {{firstName}}}
 */
export function processSpintax(text: string, seed: string): string {
  return text.replaceAll(SPINTAX_REGEX_GLOBAL, (match, optionsStr: string) => {
    const options = optionsStr
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    if (options.length === 0) return "";

    const randomIndex = getNonSecureSeededRandomNumber(
      `${seed}-${match}`,
      0,
      options.length - 1
    );
    return options[randomIndex] ?? "";
  });
}
