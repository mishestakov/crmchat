import type {
  ProjectMessage,
  ProjectOpener,
  ProjectDunning,
  MessageVariant,
} from "../db/schema";

// Бэкфилл плоской ленты messages[] → {opener, dunning} (§8 bd-autodogon).
// messages[0] — опенер (первое касание); messages[1..] — пинги пиналки, их
// delay → каданс intervals. Финальный оффер (idx 1000) живёт ВНЕ messages —
// здесь не участвует. Пустая лента → пустой опенер + пустая пиналка.
//
// Один источник для seed-демо и прод-бэкфилла, чтобы конверсия не разъезжалась.
export function messagesToOpenerDunning(messages: ProjectMessage[]): {
  opener: ProjectOpener;
  dunning: ProjectDunning;
} {
  const [first, ...pings] = messages;
  return {
    opener: {
      text: first?.text ?? "",
      warmText: first?.warmText ?? null,
    },
    dunning: {
      pings: pings.map((m): MessageVariant => ({ kind: "text", text: m.text })),
      intervals: pings.map((m) => m.delay),
    },
  };
}
