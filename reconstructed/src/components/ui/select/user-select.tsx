import { forwardRef, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { DistributiveOmit } from "@repo/core/types";

import { Combobox, Option, SingleComboboxProps } from "../combobox";
import { MemberAvatar } from "../member-avatar";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";

export const UserSelect = forwardRef<
  HTMLButtonElement,
  DistributiveOmit<
    SingleComboboxProps<Option & { avatarUrl: string | undefined }>,
    "options" | "multiple"
  >
>((props, ref) => {
  const { t } = useTranslation();
  const { members, isPending, isError } = useWorkspaceMembers();
  const options = useMemo(
    () =>
      members?.map((member) => ({
        value: member.userId,
        label: member.user.name,
        avatarUrl: member.user.avatarUrl,
      })) ?? [],
    [members]
  );

  return (
    <Combobox
      {...props}
      ref={ref}
      options={options}
      placeholder={
        isError
          ? t("web.failedToLoad")
          : isPending
            ? t("web.loading")
            : props.placeholder
      }
      renderItem={(option) => (
        <div className="flex items-center gap-2 overflow-hidden">
          <MemberAvatar
            className="size-4 shrink-0"
            member={{
              user: { name: option.label, avatarUrl: option.avatarUrl },
            }}
          />
          <span className="text-ellipsis whitespace-nowrap">
            {option.label}
          </span>
        </div>
      )}
      renderNothingFound={isError ? () => t("web.failedToLoad") : undefined}
    />
  );
});
