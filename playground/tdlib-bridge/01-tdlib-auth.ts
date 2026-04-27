import { makeClient, tdl } from './_shared.js';
import input from 'input';

const client = makeClient('td-database');

client.on('error', (e) => console.error('[tdl error]', e));
client.on('update', (u: any) => {
  if (u._ === 'updateAuthorizationState') {
    console.log('[auth-state]', u.authorization_state._);
  }
});

await client.login(() => ({
  type: 'user',
  getPhoneNumber: async () => input.text('phone (e.164): '),
  getAuthCode: async () => input.text('SMS code: '),
  getPassword: async () => input.text('2FA password: '),
  getName: async () => ({ firstName: 'spike', lastName: '' }),
}));

const me = await client.invoke({ _: 'getMe' });
console.log('[me]', { id: (me as any).id, first: (me as any).first_name });

await client.close();
console.log('[done] td-database/ ready for 02 / 03');
