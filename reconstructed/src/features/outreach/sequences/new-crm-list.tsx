import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { UsersIcon } from "lucide-react";
import { omit } from "radashi";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  MultiSelectProperty,
  OutreachListWithId,
  SingleSelectProperty,
  View,
} from "@repo/core/types";

import { ContactAvatar } from "@/components/ui/contact-avatar";
import { MainButton } from "@/components/ui/main-button";
import { RadioButton } from "@/components/ui/radio-button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tip } from "@/components/ui/tooltip";
import {
  AddFilterMenu,
  PropertyFilterMenu,
} from "@/features/contacts/contact-view-filters";
import { useProperties } from "@/hooks/useProperties";
import { orpc } from "@/lib/orpc";
import { useCurrentWorkspace, useWorkspaceStore } from "@/lib/store";
import { selectEnrichedContacts } from "@/lib/store/selectors";

export function NewCrmList({
  contactType,
  onNewListCreated,
}: {
  contactType: "contact" | "group";
  onNewListCreated: (
    list: Omit<OutreachListWithId, "createdAt" | "updatedAt">
  ) => void;
}) {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const [listType, setListType] = useState<"one-time" | "dynamic">("one-time");
  const [filters, setFilters] = useState<View["filters"]>({});
  const [properties] = useProperties("contacts");
  const contactItems = useWorkspaceStore((s) =>
    selectEnrichedContacts(s, {
      q: "",
      sort: "default",
      filters,
      contactType,
      withTelegramId: contactType === "group",
      withTelegramUsername: contactType === "contact",
    })
  );

  const hasFilters = Object.values(filters ?? {}).some((v) => v.length > 0);
  const { mutateAsync, isPending } = useMutation(
    orpc.outreach.lists.createCrmList.mutationOptions()
  );

  return (
    <>
      <h2 className="mx-3 font-medium">{t("web.outreach.list.crm.type")}</h2>
      <div className="bg-card flex flex-col divide-y rounded-lg">
        <button
          type="button"
          onClick={() => setListType("one-time")}
          className="flex items-start gap-2 px-4 py-3"
        >
          <RadioButton checked={listType === "one-time"} />
          <div className="flex flex-col items-start gap-1">
            <span className="text-sm font-medium">
              {t("web.outreach.list.crm.oneTime")}
            </span>
            <p className="text-muted-foreground text-left text-xs">
              {t("web.outreach.list.crm.oneTimeDescription")}
            </p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setListType("dynamic")}
          className="flex items-start gap-2 px-4 py-3"
        >
          <RadioButton checked={listType === "dynamic"} />
          <div className="flex flex-col items-start gap-1">
            <span className="text-sm font-medium">
              {t("web.outreach.list.crm.dynamic")}
            </span>
            <p className="text-muted-foreground text-left text-xs">
              {contactType === "contact"
                ? t("web.outreach.list.crm.dynamicLeadsDescription")
                : t("web.outreach.list.crm.dynamicGroupsDescription")}
            </p>
          </div>
        </button>
      </div>

      <h2 className="mx-3 mt-4 font-medium">
        {t("web.outreach.list.crm.filters")}
      </h2>
      <ScrollArea>
        <div className="flex pb-3">
          {Object.entries(filters).map(([propertyKey, values]) => {
            const property = properties.find((p) => p.key === propertyKey) as
              | SingleSelectProperty
              | MultiSelectProperty;
            return (
              <PropertyFilterMenu
                key={property.key}
                property={property}
                values={values}
                onChange={(v) =>
                  setFilters(
                    v === null
                      ? omit(filters, [property.key])
                      : { ...filters, [property.key]: v }
                  )
                }
              />
            );
          })}
          <AddFilterMenu
            selected={Object.keys(filters)}
            onSelect={(key) => {
              setFilters({ ...filters, [key]: [] });
            }}
            label={t("web.contacts.filters.addFilterLong")}
          />
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {hasFilters && (
        <div className="mt-1 flex flex-col">
          <h2 className="mx-3 font-medium">
            {t("web.outreach.list.crm.preview")}
          </h2>
          <div className="mt-2 flex flex-col divide-y">
            {contactItems.map(({ contact }) => (
              <div
                key={contact.id}
                className="bg-card text-card-foreground flex items-center gap-2 p-3 first:rounded-t-lg last:rounded-b-lg"
              >
                <ContactAvatar contact={contact} className="size-7" />
                <div className="flex min-w-0 items-center gap-1">
                  {contact.type === "group" && (
                    <Tip
                      content={t("web.contacts.groupChatTooltip")}
                      className="relative -top-px inline-flex shrink-0"
                    >
                      <UsersIcon className="text-muted-foreground size-3" />
                    </Tip>
                  )}
                  <p className="sensitive w-full truncate text-sm font-medium">
                    {contact.fullName}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {contactItems.length === 0 ? (
            <div className="text-muted-foreground mx-3 text-sm">
              {t("web.outreach.list.crm.noLeadsMatchFilters")}
            </div>
          ) : (
            contactType === "contact" && (
              <div className="text-muted-foreground mx-3 mt-1 text-xs">
                {t("web.outreach.list.crm.onlyTelegramUsername")}
              </div>
            )
          )}
        </div>
      )}

      {hasFilters && contactItems.length > 0 && (
        <MainButton
          className="sticky bottom-3 mt-4"
          onClick={async () => {
            const { data: list } = await mutateAsync({
              params: { workspaceId },
              body: {
                contactType,
                name: format(new Date(), "yyyy-MM-dd HH:mm"),
                dynamic: listType === "dynamic",
                filters,
              },
            });
            onNewListCreated(list);
          }}
          loading={isPending}
        >
          {t("web.outreach.list.crm.createCampaign")}
        </MainButton>
      )}
    </>
  );
}
