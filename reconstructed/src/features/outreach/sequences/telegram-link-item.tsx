import { use } from "react";

import { parseTelegramUsername } from "@repo/core/utils";
import { normalizePhoneToE164 } from "@repo/core/utils/phone";

import telegramLogo from "@/assets/telegram-logo.svg";

const libphonenumber = import("libphonenumber-js");

function useFormatPhone(phone: string | null): string | null {
  const { parsePhoneNumberWithError } = use(libphonenumber);
  if (!phone) return null;
  try {
    return parsePhoneNumberWithError(phone).formatInternational();
  } catch {
    return phone;
  }
}

export function TelegramLinkItem(props: { username?: string; phone?: string }) {
  const username = parseTelegramUsername(props.username ?? "", {
    allowRawUsername: true,
  });
  const phone = props.phone ? normalizePhoneToE164(props.phone) : null;
  const formattedPhone = useFormatPhone(phone);

  if (username) {
    return (
      <a
        href={`https://t.me/${username}`}
        target="_blank"
        className="group/username flex items-center gap-2"
      >
        <img src={telegramLogo} alt="Telegram logo" className="size-4" />
        <div className="flex flex-col gap-0.5">
          <span className="font-medium group-hover/username:underline">
            {username}
          </span>
          {formattedPhone && (
            <span className="text-muted-foreground text-xs">
              {formattedPhone}
            </span>
          )}
        </div>
      </a>
    );
  }

  if (phone) {
    return (
      <a
        href={`https://t.me/${phone}`}
        target="_blank"
        className="group/username flex items-center gap-2"
      >
        <img src={telegramLogo} alt="Telegram logo" className="size-4" />
        <span className="font-medium group-hover/username:underline">
          {formattedPhone}
        </span>
      </a>
    );
  }

  return (
    <span className="text-destructive">{props.username ?? props.phone}</span>
  );
}
