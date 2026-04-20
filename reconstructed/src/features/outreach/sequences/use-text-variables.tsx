import { useQuery } from "@tanstack/react-query";
import { TFunction } from "i18next";
import { FileIcon, RectangleEllipsisIcon, ShuffleIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { OutreachListWithId } from "@repo/core/types";

import telegramIcon from "@/assets/telegram-logo.svg";
import { TextVariable } from "@/components/ui/editor/plugins/text-variables/text-variables-plugin";
import { useProperties } from "@/hooks/useProperties";
import { useTRPC } from "@/lib/trpc";

const TELEGRAM_VARIABLES = (t: TFunction): TextVariable[] => [
  {
    variable: "username",
    label: t("web.outreach.sequences.variables.username"),
    icon: <TelegramIcon />,
  },
  {
    variable: "firstName",
    label: t("web.outreach.sequences.variables.firstName"),
    icon: <TelegramIcon />,
  },
];

const SENDER_VARIABLES = (t: TFunction): TextVariable[] => [
  {
    variable: "sender.firstName",
    label: t("web.outreach.sequences.variables.senderFirstName"),
    icon: <TelegramIcon />,
  },
  {
    variable: "sender.fullName",
    label: t("web.outreach.sequences.variables.senderFullName"),
    icon: <TelegramIcon />,
  },
];

// eslint-disable-next-line react-refresh/only-export-components
function TelegramIcon() {
  return <img src={telegramIcon} className="size-4" />;
}

function useListVariables(
  list: OutreachListWithId | undefined
): TextVariable[] {
  const [properties] = useProperties("contacts");

  if (list?.source.type === "csvFile") {
    return list.source.columns.map((columnHeader) => ({
      variable: columnHeader,
      label: columnHeader,
      icon: <FileIcon className="text-muted-foreground size-4" />,
    }));
  }

  if (list?.source.type === "crm" || list?.source.type === "crmGroups") {
    return properties.map((property) => ({
      variable: property.key,
      label: property.name,
      icon: <RectangleEllipsisIcon className="text-muted-foreground size-4" />,
      shouldValidate: true,
    }));
  }

  return [];
}

function useNotDefinedVariables(list: OutreachListWithId | undefined) {
  const trpc = useTRPC();
  const { data, isPending } = useQuery(
    trpc.outreach.validateTextVariables.queryOptions(
      {
        workspaceId: list?.workspaceId ?? "",
        listId: list?.id ?? "",
      },
      {
        enabled:
          list?.source.type === "crm" || list?.source.type === "crmGroups",
        refetchOnWindowFocus: false,
        refetchInterval: 1000 * 60 * 5,
      }
    )
  );

  return {
    data: data ? new Map(Object.entries(data)) : undefined,
    isPending,
  };
}

export function useTextVariables(list: OutreachListWithId | undefined) {
  const { t } = useTranslation();
  const listVariables = useListVariables(list);
  const { data: notDefinedVariables, isPending: notDefinedVariablesPending } =
    useNotDefinedVariables(list);

  return {
    variables: [
      ...TELEGRAM_VARIABLES(t),
      {
        variable: "{ option1 | option2 }",
        label: t("web.outreach.sequences.variables.random"),
        icon: <ShuffleIcon className="text-muted-foreground size-4" />,
        plainText: true,
      },
      ...listVariables,
      ...SENDER_VARIABLES(t),
    ],
    notDefined: {
      map: notDefinedVariables,
      isPending: notDefinedVariablesPending,
    },
  };
}
