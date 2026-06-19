// Единая метка outreach-аккаунта для UI. @username первым: firstName у всех
// аккаунтов часто одинаковый («Mike»), а username уникален — иначе непонятно, с
// какого аккаунта пишем. Общий для драйвера чата и списка каналов.
export function formatAccount(a: {
  id: string;
  firstName: string | null;
  tgUsername: string | null;
  phoneNumber: string | null;
}): string {
  if (a.tgUsername) return `@${a.tgUsername}`;
  if (a.firstName) return a.firstName;
  if (a.phoneNumber) return a.phoneNumber;
  return a.id;
}
