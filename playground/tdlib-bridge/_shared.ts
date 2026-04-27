import * as tdl from 'tdl';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

loadEnv({ path: resolve(import.meta.dirname, '../../.env') });

const LIBDIR = process.env.TDLIB_LIBDIR ?? '/home/mike/td/build';

if (!existsSync(`${LIBDIR}/libtdjson.so`)) {
  throw new Error(`libtdjson.so not found in ${LIBDIR}`);
}

tdl.configure({ tdjson: 'libtdjson.so', libdir: LIBDIR });

export const apiId = Number(process.env.TELEGRAM_API_ID);
export const apiHash = process.env.TELEGRAM_API_HASH!;

if (!apiId || !apiHash) {
  throw new Error('TELEGRAM_API_ID / TELEGRAM_API_HASH not set in .env');
}

export function makeClient(databaseDir: string) {
  return tdl.createClient({
    apiId,
    apiHash,
    databaseDirectory: resolve(import.meta.dirname, databaseDir),
    filesDirectory: resolve(import.meta.dirname, `${databaseDir}/files`),
    tdlibParameters: {
      use_message_database: false,
      use_secret_chats: false,
      system_language_code: 'en',
      device_model: 'crmchat-spike',
      application_version: '0.0.1',
    },
  });
}

export { tdl };
