// Формат session, который ждёт TWA-iframe (apps/tg-client → ApiSessionData):
//   { mainDcId, keys: { [dcId]: hexAuthKey } }
//
// Сам auth_key собирается в provision-iframe-session.ts через наш патч
// `getRawAuthKey dc_id` (см. tools/tdlib/patches/0001-add-getRawAuthKey.patch).
export type TwaSession = {
  mainDcId: number;
  keys: Record<number, string>;
};
