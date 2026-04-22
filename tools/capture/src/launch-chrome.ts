/**
 * Launches a dedicated Chrome instance with a persistent user-data-dir and
 * remote-debugging port, so capture.ts can attach via CDP. The profile
 * survives between runs — you log in once and stay logged in.
 *
 * Usage: npm run launch
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const PORT = 9222;
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
const PROFILE = path.resolve(HERE, "..", "profile");
fs.mkdirSync(PROFILE, { recursive: true });

function findChrome(): string {
  const env = process.env.CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(os.homedir(), "AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("Chrome not found. Set CHROME_PATH env var.");
}

const chrome = findChrome();
const args = [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-features=IsolateOrigins,site-per-process",
  "https://app.crmchat.ai/",
];

console.log(`[+] Chrome: ${chrome}`);
console.log(`[+] Profile: ${PROFILE}`);
console.log(`[+] Debug port: ${PORT}`);
console.log(`[+] Opening https://app.crmchat.ai/ — log in, then run: npm run start`);
console.log();

const proc = spawn(chrome, args, { stdio: "inherit", detached: false });
proc.on("exit", (code) => {
  console.log(`[=] Chrome exited with code ${code}`);
  process.exit(code ?? 0);
});
