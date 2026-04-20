import { CoinsIcon } from "lucide-react";
import { get } from "radashi";
import { Fragment } from "react";

import { ContactWithId, Property } from "@repo/core/types";

import { Badge } from "@/components/ui/badge";

export function DisplayedProperties({
  displayedProperties,
  contact,
}: {
  displayedProperties: Property[];
  contact: ContactWithId;
}) {
  const data = displayedProperties
    .map((property) => ({
      rendered: renderDisplayedProperty({
        property,
        contact,
        limit: 2,
      }),
      property,
    }))
    .filter((p) => p.rendered);

  if (data.length === 0) {
    return null;
  }

  return (
    <div className="relative flex flex-wrap gap-0.5">
      {data.map(({ rendered, property }, i) => (
        <Fragment key={property.key}>
          {i > 0 && (
            <span className="text-muted-foreground/50 px-0.5 text-xs">•</span>
          )}
          {rendered}
        </Fragment>
      ))}
    </div>
  );
}

function renderDisplayedProperty({
  property,
  contact,
  limit = Infinity,
}: {
  property: Property;
  contact: ContactWithId;
  limit?: number;
}) {
  const value: any = get(contact, property.key);

  if (property.type === "amount") {
    if (contact.amount !== undefined && contact.amount > 0) {
      return (
        <Badge
          shape="squareSmall"
          variant="outline"
          className="gap-0.5 whitespace-nowrap font-normal"
        >
          <CoinsIcon className="size-3" />
          {new Intl.NumberFormat(navigator.language).format(value)}
        </Badge>
      );
    }
    return null;
  }

  if (property.type === "single-select") {
    const option = property.options.find((o) => o.value === value);
    if (option) {
      return (
        <Badge
          shape="squareSmall"
          variant={option.color ?? "secondary"}
          className="whitespace-nowrap font-normal"
        >
          {option.label}
        </Badge>
      );
    }
    return null;
  }

  if (property.type === "multi-select") {
    const options = value
      ? property.options.filter((o) => value.includes(o.value))
      : [];
    if (options.length > 0) {
      return (
        <>
          {options.slice(0, limit).map((option) => (
            <Badge
              key={option.value}
              shape="squareSmall"
              variant={option.color ?? "secondary"}
              className="truncate whitespace-nowrap font-normal"
            >
              {option.label}
            </Badge>
          ))}
          {options.length > limit && (
            <Badge
              shape="squareSmall"
              variant="secondary"
              className="whitespace-nowrap font-normal"
            >
              +{options.length - limit}
            </Badge>
          )}
        </>
      );
    }
  }

  return null;
}
