import { Flame, Music2, PlaySquare, Send } from "lucide-react";
import type { ComponentType } from "react";
import type { Channel } from "@repo/core";

// Конфиг площадок (этап 17): значок, метка, цвет, шаблон ссылки на профиль.
// Общий для списка «Площадки» (channels.tsx) и карточки канала (channel-card).
export type Platform = Channel["platform"];

type PlatformIcon = ComponentType<{ size?: number; className?: string }>;

export const PLATFORMS: Record<
  Platform,
  { label: string; Icon: PlatformIcon; color: string; url: (handle: string) => string }
> = {
  telegram: { label: "Telegram", Icon: Send, color: "text-sky-600", url: (u) => `https://t.me/${u}` },
  youtube: { label: "YouTube", Icon: PlaySquare, color: "text-red-600", url: (u) => `https://www.youtube.com/@${u}` },
  tiktok: { label: "TikTok", Icon: Music2, color: "text-zinc-900", url: (u) => `https://www.tiktok.com/@${u}` },
  dzen: { label: "Дзен", Icon: Flame, color: "text-amber-500", url: (u) => `https://dzen.ru/${u}` },
  // MAX — настоящий лого (lucide-иконки нет); MaxLogo lucide-совместим (size).
  max: { label: "MAX", Icon: MaxLogo, color: "text-violet-600", url: (u) => `https://max.ru/${u}` },
};

// Площадки, которые умеем добавлять по ссылке (внешний провайдер). Telegram
// заводится импортом/из трафика, MAX — задел.
export const ADDABLE: Platform[] = ["youtube", "tiktok", "dzen"];

// Настоящий логотип MAX (их favicon, public/max-logo.png) — подходящей
// lucide-иконки нет, монограмма не похожа. Функциональное обозначение
// платформы, как иконки провайдеров в OAuth-кнопках.
export const MAX_LOGO_SRC = "/max-logo.svg";

export function MaxLogo({
  size = 14,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={MAX_LOGO_SRC}
      alt="MAX"
      width={size}
      height={size}
      className={`inline-block shrink-0 rounded-[4px] object-contain ${className}`}
    />
  );
}

export function PlatformBadge({
  platform,
  size = 14,
  className = "",
}: {
  platform: Platform;
  size?: number;
  className?: string;
}) {
  const { label, Icon, color } = PLATFORMS[platform];
  return (
    <span title={label} className={`inline-flex ${color} ${className}`}>
      <Icon size={size} />
    </span>
  );
}
