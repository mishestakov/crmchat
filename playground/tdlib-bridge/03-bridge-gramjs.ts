import { makeClient, apiId, apiHash } from './_shared.js';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const tdClient = makeClient('td-database');

let authState = '';
tdClient.on('error', (e) => console.error('[tdl error]', e));
tdClient.on('update', (u: any) => {
  if (u._ === 'updateAuthorizationState') {
    authState = u.authorization_state._;
    console.log('[td auth-state]', authState);
  }
});

console.log('[1/4] starting TDLib (must already be authorized via 01)…');
await tdClient.invoke({ _: 'getMe' }).catch((e) => {
  throw new Error(`TDLib not authorized — run 01 first. (${e?.message})`);
});
const tdMe = await tdClient.invoke({ _: 'getMe' });
console.log('  TDLib user:', (tdMe as any).id);

console.log('[2/4] starting fresh gramjs client (empty session)…');
const gram = new TelegramClient(new StringSession(''), apiId, apiHash, {
  connectionRetries: 3,
  deviceModel: 'crmchat-spike-iframe',
});
await gram.connect();

console.log('[3/4] gramjs requests login token; TDLib confirms it…');
const tokenRes = (await gram.invoke(
  new Api.auth.ExportLoginToken({ apiId, apiHash, exceptIds: [] }),
)) as any;

let qrLink: string;
if (tokenRes.className === 'auth.LoginToken') {
  const tokenB64 = Buffer.from(tokenRes.token).toString('base64url');
  qrLink = `tg://login?token=${tokenB64}`;
} else {
  throw new Error(`unexpected ExportLoginToken response: ${tokenRes.className}`);
}
console.log('  qr link generated, asking TDLib to confirm…');

const session = await tdClient.invoke({
  _: 'confirmQrCodeAuthentication',
  link: qrLink,
});
console.log('  confirmed:', { id: (session as any).id, device: (session as any).device_model });

console.log('[4/4] gramjs polls for accepted token, then sends Saved Messages msg…');
const accepted = (await gram.invoke(
  new Api.auth.ExportLoginToken({ apiId, apiHash, exceptIds: [] }),
)) as any;

if (accepted.className === 'auth.LoginTokenSuccess') {
  console.log('  gramjs auth accepted!');
} else if (accepted.className === 'auth.LoginTokenMigrateTo') {
  console.log('  gramjs needs DC migration → ', accepted.dcId);
  await (gram as any)._switchDC(accepted.dcId);
  const migrated = await gram.invoke(
    new Api.auth.ImportLoginToken({ token: accepted.token }),
  );
  console.log('  migrated result:', (migrated as any).className);
} else {
  console.log('  unexpected accepted response:', accepted.className);
}

const gramMe = await gram.getMe();
console.log('  gramjs user:', (gramMe as any).id?.toString?.());

const sent = await gram.sendMessage('me', {
  message: `crmchat tdlib-bridge spike OK @ ${new Date().toISOString()}`,
});
console.log('  sent message id:', sent.id);

const exported = (gram.session as StringSession).save();
console.log('\n[result] gramjs StringSession (first 80 chars):', exported.slice(0, 80) + '…');
console.log('[result] gramjs session exported, can be reused without re-pairing.');

await gram.disconnect();
await tdClient.close();
