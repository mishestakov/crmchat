import { useNavigate } from "@tanstack/react-router";
import { CoinsIcon, DotIcon } from "lucide-react";
import { PropsWithChildren, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Property, WorkspaceObjectType } from "@repo/core/types";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useCreateablePropertiesMetadata,
  useProperties,
} from "@/hooks/useProperties";
import { useCurrentWorkspace } from "@/lib/store";

export function NewPropertyButton({
  objectType,
  onSelect,
  children,
}: PropsWithChildren<{
  objectType: WorkspaceObjectType;
  onSelect?: <T extends Property>(type: T["type"], data?: Partial<T>) => void;
}>) {
  const { t } = useTranslation();
  const types = useCreateablePropertiesMetadata();
  const navigate = useNavigate();

  const workspaceId = useCurrentWorkspace((s) => s.id);
  const [properties] = useProperties(objectType);
  const currentKeys = useMemo(
    () => new Set(properties.map((p) => p.key)),
    [properties]
  );

  const onSelectOrNavigate = <T extends Property>(
    type: T["type"],
    data?: Partial<T>
  ) => {
    if (onSelect) {
      onSelect(type, data);
    } else {
      navigate({
        to: "/w/$workspaceId/settings/properties/$objectType/new/$type",
        params: { workspaceId, objectType, type },
        search: { data },
      });
    }
  };

  const standardProps = [
    // eslint-disable-next-line unicorn/no-negated-condition
    ...(!currentKeys.has("amount")
      ? [
          <DropdownMenuItem
            key="amount"
            onClick={() =>
              onSelectOrNavigate("amount", {
                key: "amount",
                name: t("web.contacts.form.amount"),
                displayedInList: true,
              })
            }
          >
            <CoinsIcon />
            {t("web.contacts.form.amount")}
          </DropdownMenuItem>,
        ]
      : []),
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent>
        {standardProps.map((p) => p)}
        {standardProps.length > 0 && <DropdownMenuSeparator />}

        {types.map((t) => (
          <DropdownMenuItem
            key={t.type}
            onClick={() => onSelectOrNavigate(t.type)}
          >
            <DotIcon className="opacity-0" />
            {t.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
