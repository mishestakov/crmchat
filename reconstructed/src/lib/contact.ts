import { Contact, ContactAccountStatus } from "@repo/core/types";

export function hasUnreadMessages(
  contact: Contact,
  existingAccountIds: ReadonlySet<string>
) {
  return Object.entries(contact.telegram?.account || {}).some(
    ([accountId, account]) =>
      existingAccountIds.has(accountId) && account.unread
  );
}

export function getUnreadCount(
  contact: Contact,
  existingAccountIds: ReadonlySet<string>
) {
  let sum = 0;
  for (const [accountId, account] of Object.entries(
    contact.telegram?.account || {}
  )) {
    if (existingAccountIds.has(accountId)) {
      sum += getUnreadCountForAccount(account);
    }
  }
  return sum;
}

export function getUnreadCountForAccount(status: ContactAccountStatus) {
  if (status.unreadCount > 0) {
    return status.unreadCount;
  }
  return status.unread ? 1 : 0;
}
