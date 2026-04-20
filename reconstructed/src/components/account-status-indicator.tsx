import { TelegramAccountWithId } from "@repo/core/types";

import { Tip } from "./ui/tooltip";

export function AccountStatusIndicator({
  account,
}: {
  account: TelegramAccountWithId;
}) {
  switch (account.status) {
    case "active":
      return (
        <Tip content="Active">
          <span className="size-2 shrink-0 rounded-full bg-green-500" />
        </Tip>
      );
    case "frozen":
      return (
        <span className="bg-destructive text-destructive-foreground shrink-0 rounded-full px-2 text-xs uppercase">
          Frozen
        </span>
      );
    case "banned":
      return (
        <span className="bg-destructive text-destructive-foreground shrink-0 rounded-full px-2 text-xs uppercase">
          Banned
        </span>
      );
    case "offline":
      return (
        <Tip content="Offline">
          <span className="size-2 shrink-0 rounded-full bg-gray-400" />
        </Tip>
      );
    case "unauthorized":
      return (
        <Tip content="Unauthorized">
          <span className="bg-destructive size-2 shrink-0 rounded-full" />
        </Tip>
      );
  }
}
