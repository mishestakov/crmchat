import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "../db/client.ts";
import { scheduledMessages } from "../db/schema.ts";
import { FINAL_OFFER_MSG_IDX } from "./project-scheduling.ts";

// Окончательный провал шага цепочки: помечаем шаг failed и гасим все
// последующие догоны этого лида (idx больше упавшего, до финального оффера),
// которые ещё ждут отправки. После непреодолимого отказа (бот, нет @username,
// приватность) гнаться за каналом бессмысленно, а догоны иначе вечно висят
// pending на sentinel-дате «после предыдущего» — зомби-строки в UI. Финальный
// оффер не трогаем: у него своя семантика «для ответивших».
//
// Атомарно. Общий инвариант для двух путей провала, которые иначе расходятся
// (и расхождение как раз было багом): sync-throw из sendMessage в воркере и
// async updateMessageSendFailed в листенере.
export async function failStepAndCancelFollowups(args: {
  id: string;
  itemId: string;
  messageIdx: number;
  error: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(scheduledMessages)
      .set({ status: "failed", error: args.error, sentAt: null })
      .where(eq(scheduledMessages.id, args.id));
    await tx
      .update(scheduledMessages)
      .set({ status: "cancelled", error: "prior step failed" })
      .where(
        and(
          eq(scheduledMessages.itemId, args.itemId),
          gt(scheduledMessages.messageIdx, args.messageIdx),
          lt(scheduledMessages.messageIdx, FINAL_OFFER_MSG_IDX),
          eq(scheduledMessages.status, "pending"),
        ),
      );
  });
}
