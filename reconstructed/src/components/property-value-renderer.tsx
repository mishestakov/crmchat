import { get } from "radashi";
import { JSX } from "react";

import { Property } from "@repo/core/types";

import { Badge } from "./ui/badge";
import { MemberAvatar } from "./ui/member-avatar";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";

interface RenderPropertyValueOptions {
  property: Property;
  object: any;
  fallback?: JSX.Element;
}

export function RenderPropertyValue({
  property,
  object,
  fallback,
}: RenderPropertyValueOptions) {
  const { membersMap } = useWorkspaceMembers();

  const value: any = object[property.key] ?? get(object, property.key);
  if (!value) return fallback;

  switch (property.type) {
    case "text":
    case "textarea":
    case "tel":
    case "amount":
      return value;
    case "email":
      return (
        <a target="_blank" href={`mailto:${value}`}>
          {value}
        </a>
      );
    case "url":
      return (
        <a target="_blank" href={value}>
          {value}
        </a>
      );
    case "single-select": {
      const option = property.options.find((o) => o.value === value);
      if (!option) return fallback;
      return (
        <Badge
          shape="square"
          variant={option.color ?? "secondary"}
          className="whitespace-nowrap"
        >
          {option.label}
        </Badge>
      );
    }
    case "multi-select": {
      const options = property.options.filter((o) => value.includes(o.value));
      if (options.length === 0) return fallback;
      return (
        <div className="flex flex-wrap gap-1">
          {options.map((option) => (
            <Badge
              key={option.value}
              shape="squareSmall"
              variant={option.color ?? "secondary"}
              className="whitespace-nowrap"
            >
              {option.label}
            </Badge>
          ))}
        </div>
      );
    }
    case "user-select": {
      const member = membersMap.get(value ?? "");
      if (!member) return fallback;
      return (
        <div className="flex items-center gap-2 overflow-hidden">
          <MemberAvatar className="size-4 shrink-0" member={member} />
          <span className="truncate text-ellipsis whitespace-nowrap">
            {member.user.name}
          </span>
        </div>
      );
    }
    default:
      return value;
  }
}
