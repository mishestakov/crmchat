import { useTranslation } from "react-i18next";

import { Property } from "@repo/core/types";

import { FieldSelectorNew } from "./field-selector-new";
import { cn } from "@/lib/utils";

export function FieldSelector<TKey extends string>({
  className,
  visibleProperties,
  onSelect,
  setFocus,
  properties,
  canCreateNew = true,
  label,
}: {
  className?: string;
  visibleProperties: Set<TKey>;
  onSelect: (key: TKey) => void;
  setFocus: (name: TKey) => void;
  properties: (Property & { key: TKey })[];
  canCreateNew?: boolean;
  label?: string;
}) {
  const { t } = useTranslation();
  const hiddenProperties = properties.filter(
    (p) => !visibleProperties.has(p.key) && !p.readonly
  );
  label = label ?? t("web.contacts.form.add");

  if (!canCreateNew && hiddenProperties.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "text-muted-foreground flex items-start gap-2 text-sm",
        className
      )}
    >
      {label && <span className="py-[5px]">{label}</span>}
      <div className="flex grow flex-wrap gap-2">
        {hiddenProperties.map((property) => (
          <button
            key={property.key}
            type="button"
            onClick={() => {
              // ios fix: you can't set a focus in a timeout
              // so we need to create an hidden element on user interaction and focus it
              // and after that move a focus to the field
              const el = document.createElement("input");
              el.type = "text";
              el.style.position = "absolute";
              el.style.left = "-9999px";
              el.style.opacity = "0";
              el.style.pointerEvents = "none";
              document.body.append(el);
              el.focus();

              onSelect(property.key);
              setTimeout(() => {
                setFocus(property.key);
                el.remove();
              }, 50);
            }}
            className="bg-card/90 border-input hover:bg-primary hover:border-primary hover:text-primary-foreground inline-block rounded-full border px-3 py-1 transition-colors"
          >
            {property.name}
          </button>
        ))}
        {canCreateNew && (
          <FieldSelectorNew showLabel={hiddenProperties.length === 0} />
        )}
      </div>
    </div>
  );
}
