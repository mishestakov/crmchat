import { Flame, Music2, PlaySquare, Radio, Send } from "lucide-react";
import type { Channel } from "@repo/core";

// Конфиг площадок (этап 17): значок, метка, цвет, шаблон ссылки на профиль.
// Общий для списка «Площадки» (channels.tsx) и карточки канала (channel-card).
export type Platform = Channel["platform"];

export const PLATFORMS: Record<
  Platform,
  { label: string; Icon: typeof Send; color: string; url: (handle: string) => string }
> = {
  telegram: { label: "Telegram", Icon: Send, color: "text-sky-600", url: (u) => `https://t.me/${u}` },
  youtube: { label: "YouTube", Icon: PlaySquare, color: "text-red-600", url: (u) => `https://www.youtube.com/@${u}` },
  tiktok: { label: "TikTok", Icon: Music2, color: "text-zinc-900", url: (u) => `https://www.tiktok.com/@${u}` },
  dzen: { label: "Дзен", Icon: Flame, color: "text-amber-500", url: (u) => `https://dzen.ru/${u}` },
  max: { label: "MAX", Icon: Radio, color: "text-violet-600", url: (u) => `https://max.ru/${u}` },
};

// Площадки, которые умеем добавлять по ссылке (внешний провайдер). Telegram
// заводится импортом/из трафика, MAX — задел.
export const ADDABLE: Platform[] = ["youtube", "tiktok", "dzen"];

export function PlatformBadge({ platform }: { platform: Platform }) {
  const p = PLATFORMS[platform];
  const { Icon } = p;
  return (
    <span title={p.label} className={`inline-flex ${p.color}`}>
      <Icon size={14} />
    </span>
  );
}
