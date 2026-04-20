import { User } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function MemberAvatar({
  member,
  className,
}: {
  member: { user: { name: string; avatarUrl?: string } };
  className?: string;
}) {
  return (
    <Avatar className={cn(`ph-no-capture`, className)}>
      <AvatarImage
        alt={`${member.user.name}'s avatar`}
        src={member.user.avatarUrl}
        loading="lazy"
      />
      <AvatarFallback className="group-aria-selected:bg-slate-200 dark:group-aria-selected:bg-slate-700">
        <User className="text-muted-foreground p-[3px]" />
      </AvatarFallback>
    </Avatar>
  );
}
