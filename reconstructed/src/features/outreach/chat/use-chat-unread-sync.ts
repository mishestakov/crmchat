import { debounce } from "radashi";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { updateContact } from "@/lib/db/contacts";
import { selectContactByTelegramIdOrUsername } from "@/lib/store/selectors";
import { useWorkspacesStore } from "@/lib/store/workspaces";

const DEBOUNCE_MS = 750;

type Pending = {
  key: string;
  peerId?: string;
  username?: string;
  unreadCount: number;
};

async function syncToFirestore(accountId: string, pending: Pending) {
  const state = useWorkspacesStore.getState();
  const workspaceState = state.workspaceData[state.activeWorkspaceId];
  if (!workspaceState) return;
  const contact = selectContactByTelegramIdOrUsername(
    workspaceState,
    pending.peerId,
    pending.username
  );
  if (!contact) return;
  const current = contact.telegram?.account?.[accountId];
  if (current?.unreadCount === pending.unreadCount) return;
  await updateContact(contact.workspaceId, contact.id, {
    [`telegram.account.${accountId}`]: {
      unread: pending.unreadCount > 0,
      unreadCount: pending.unreadCount,
    },
  });
  console.info("Synced unread count", pending);
}

export function useChatUnreadSync(accountId: string) {
  const pendingRef = useRef<Pending | null>(null);

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    void syncToFirestore(accountId, pending);
  }, [accountId]);

  const debounced = useMemo(
    () => debounce({ delay: DEBOUNCE_MS }, flush),
    [flush]
  );

  // Flush before cancel so closing the chat (or an accountId change) still
  // persists the last pending value instead of dropping it.
  useEffect(
    () => () => {
      flush();
      debounced.cancel();
    },
    [debounced, flush]
  );

  return useCallback(
    (
      peerId: string | undefined,
      username: string | undefined,
      unreadCount: number | undefined
    ) => {
      if (unreadCount === undefined) return;
      const key = `${peerId ?? ""}|${username ?? ""}`;
      if (pendingRef.current && pendingRef.current.key !== key) flush();
      pendingRef.current = { key, peerId, username, unreadCount };
      debounced();
    },
    [debounced, flush]
  );
}
