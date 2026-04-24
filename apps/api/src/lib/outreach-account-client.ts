import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { outreachAccounts } from "../db/schema";
import { encrypt } from "./crypto";
import { newAnonymousClient } from "./telegram-client";

// Pending-clients per workspace: только ОДИН auth-флоу за раз внутри workspace.
// Если юзер начнёт второй до окончания первого — старый сбрасываем (новый
// sendCode/getQrState создаст fresh client). Multi-instance prod: см. TODO про
// sticky-routing в telegram-client.ts.
const pending = new Map<string, TelegramClient>();

export async function getOrCreatePendingOutreachClient(
  workspaceId: string,
): Promise<TelegramClient> {
  const existing = pending.get(workspaceId);
  if (existing) return existing;
  const client = newAnonymousClient();
  await client.connect();
  pending.set(workspaceId, client);
  return client;
}

export async function clearPendingOutreachClient(
  workspaceId: string,
): Promise<void> {
  const client = pending.get(workspaceId);
  if (client) {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
    pending.delete(workspaceId);
  }
}

export async function persistOutreachAccount(
  workspaceId: string,
  userId: string,
  client: TelegramClient,
  profile: {
    tgUserId: string;
    tgUsername?: string | null;
    phoneNumber?: string | null;
    firstName?: string | null;
    hasPremium: boolean;
  },
): Promise<{ id: string }> {
  const sessionEnc = encrypt((client.session as StringSession).save() ?? "");
  const [row] = await db
    .insert(outreachAccounts)
    .values({
      workspaceId,
      session: sessionEnc,
      tgUserId: profile.tgUserId,
      tgUsername: profile.tgUsername ?? null,
      phoneNumber: profile.phoneNumber ?? null,
      firstName: profile.firstName ?? null,
      hasPremium: profile.hasPremium,
      createdBy: userId,
    })
    .onConflictDoUpdate({
      target: [outreachAccounts.workspaceId, outreachAccounts.tgUserId],
      set: {
        session: sessionEnc,
        tgUsername: profile.tgUsername ?? null,
        phoneNumber: profile.phoneNumber ?? null,
        firstName: profile.firstName ?? null,
        hasPremium: profile.hasPremium,
        status: "active",
        updatedAt: new Date(),
      },
    })
    .returning({ id: outreachAccounts.id });
  return row!;
}

export async function deleteOutreachAccount(
  workspaceId: string,
  accountId: string,
): Promise<boolean> {
  const result = await db
    .delete(outreachAccounts)
    .where(
      and(
        eq(outreachAccounts.id, accountId),
        eq(outreachAccounts.workspaceId, workspaceId),
      ),
    )
    .returning({ id: outreachAccounts.id });
  return result.length > 0;
}
