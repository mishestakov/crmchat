// Smoke test для патча TDLib `getRawAuthKey`.
// Требует: 01-tdlib-auth.ts успешно прошёл (есть td-database/).
// Запускать с собранной кастомной libtdjson.so:
//   eval "$(../../tools/tdlib/build.sh --env)" && pnpm 04
import { makeClient } from './_shared.js';

const client = makeClient('td-database');
client.on('error', (e) => console.error('[tdl error]', e));

console.log('[1/5] starting TDLib (must already be authorized via 01)...');
const me = (await client.invoke({ _: 'getMe' })) as any;
console.log('  user_id:', me.id);

console.log('[2/5] getOption("home_dc_id") to know which DC has a key...');
const homeDc = (await client.invoke({ _: 'getOption', name: 'home_dc_id' })) as any;
console.log('  home_dc_id raw:', homeDc);
const dcId = Number(homeDc?.value ?? 2);
console.log('  using DC:', dcId);

console.log('[3/5] calling custom getRawAuthKey...');
const res = (await client.invoke({ _: 'getRawAuthKey', dc_id: dcId } as any)) as any;
console.log('  type:', res._);
console.log('  dc_id:', res.dc_id);

const buf: Buffer = Buffer.isBuffer(res.auth_key)
  ? res.auth_key
  : Buffer.from(res.auth_key, 'base64');
console.log('  auth_key length:', buf.length, '(expected 256)');
console.log('  auth_key first 16 bytes:', buf.subarray(0, 16).toString('hex'));
console.log('  auth_key last  16 bytes:', buf.subarray(buf.length - 16).toString('hex'));

if (buf.length !== 256) {
  throw new Error(`unexpected auth_key length: ${buf.length}`);
}

console.log('[4/5] negative test: invalid DC id (999)...');
try {
  await client.invoke({ _: 'getRawAuthKey', dc_id: 999 } as any);
  console.log('  UNEXPECTED success');
} catch (e: any) {
  console.log('  ok, error:', e?.code ?? e?.message ?? e);
}

console.log('[5/5] negative test: DC with no auth_key (try DC 5)...');
try {
  const r = await client.invoke({ _: 'getRawAuthKey', dc_id: 5 } as any);
  console.log('  unexpected success:', r);
} catch (e: any) {
  console.log('  ok, error:', e?.code ?? e?.message ?? e);
}

await client.close();
console.log('[done] patch is alive end-to-end.');
