import { ContactWithId } from "@repo/core/types";

import { Avatar, AvatarFallback, AvatarImage } from "./avatar";
import { cn } from "@/lib/utils";

export function ContactAvatar({
  contact,
  className,
}: {
  contact: Pick<ContactWithId, "fullName" | "avatarUrl" | "type">;
  className?: string;
}) {
  return (
    <Avatar className={cn("ph-no-capture", className)}>
      <AvatarImage
        alt={`${contact.fullName}'s avatar`}
        src={contact.avatarUrl}
        loading="lazy"
      />
      <AvatarFallback>
        {contact.type === "group"
          ? (contact.fullName[0]?.toUpperCase() ?? "?")
          : contact.fullName
              .replaceAll(/ (?:[x&]|the) /g, " ")
              .split(" ", 2)
              .map((i) => i[0])
              .join("")
              .toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
