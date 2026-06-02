// Единый разбор «лички канала» из channels.meta (контракт sync→meta). Держим
// правило в одном месте: ключи direct_messages_chat_id / outgoing_paid_message_
// star_count и sentinel "0" иначе расходятся по 4 местам фронта.
//   hasDm     — у канала есть личка-группа (chat_id реальный, не 0).
//   starCost  — цена сообщения: 0 → бесплатно (пишем из CRM), >0 → вручную,
//               null → ещё не синкали (цену не утверждаем).
export function channelDm(meta: unknown): {
  hasDm: boolean;
  starCost: number | null;
} {
  const m = (meta ?? {}) as Record<string, unknown>;
  const chatId = m.direct_messages_chat_id;
  const hasDm = chatId != null && String(chatId) !== "0";
  const starCost =
    typeof m.outgoing_paid_message_star_count === "number"
      ? m.outgoing_paid_message_star_count
      : null;
  return { hasDm, starCost };
}
