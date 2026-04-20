import * as RadioGroup from "@radix-ui/react-radio-group";
import { TFunction } from "i18next";
import { Columns3Icon, ListIcon } from "lucide-react";
import { PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";

import { View } from "@repo/core/types";

import { SaveViewDialog } from "./save-view-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useProperties } from "@/hooks/useProperties";
import { useView } from "@/hooks/useViews";
import { cn } from "@/lib/utils";

export function ViewDisplayOptions({
  view,
  onChange,
  hasUnsavedFilters,
  children,
}: PropsWithChildren<{
  view: View;
  onChange: (view: View) => void;
  onReset: () => void;
  hasUnsavedFilters?: boolean;
}>) {
  const { t } = useTranslation();

  const baseView = useView("contacts", view.id);

  const [properties] = useProperties("contacts");
  const pipelineProperties = properties.filter(
    (p) => p.type === "single-select"
  );

  const sortOptions = [
    { value: "default", name: t("web.contacts.views.sort.default") },
    { value: "dueDate", name: t("web.contacts.views.sort.dueDate") },
    { value: "fullName", name: t("web.contacts.views.sort.name") },
    { value: "createdAt", name: t("web.contacts.views.sort.creationDate") },
  ];

  const handleChange = (value: View) => {
    // set initial pipeline property if not set
    if (value.type === "pipeline" && !value.pipelineProperty) {
      value.pipelineProperty = pipelineProperties[0]?.key;
    }

    // remove pipeline props if list
    if (value.type === "list") {
      value.pipelineProperty = undefined;
      value.hideEmptyColumns = undefined;
    }

    onChange(value);

    if (view.type !== value.type) {
      setTimeout(() => {
        // eslint-disable-next-line unicorn/prefer-query-selector
        document.getElementById("view-options")?.click();
      }, 200);
    }
  };

  return (
    <Popover>
      <PopoverTrigger id="view-options" asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-80" collisionPadding={10}>
        <div className="grid gap-4 md:gap-3">
          <ModeSwitcher
            value={view.type}
            onChange={(value) => handleChange({ ...view, type: value })}
          />

          <div className="mt-1 grid grid-cols-3 items-center gap-4">
            <Label variant="classic" htmlFor="view-options-sort">
              {t("web.contacts.views.sortLabel")}
            </Label>
            <Select
              value={view.sort}
              onValueChange={(value) =>
                handleChange({ ...view, sort: value as View["sort"] })
              }
            >
              <SelectTrigger
                id="view-options-sort"
                className="bg-card text-card-foreground col-span-2 h-8"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="item-aligned">
                {sortOptions.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {view.type === "pipeline" && (
            <>
              <div className="grid grid-cols-3 items-center gap-4">
                <Label
                  variant="classic"
                  htmlFor="view-options-pipeline-property"
                >
                  {t("web.contacts.views.pipelinePropertyLabel")}
                </Label>
                <Select
                  value={view.pipelineProperty ?? ""}
                  onValueChange={(value) =>
                    handleChange({ ...view, pipelineProperty: value })
                  }
                >
                  <SelectTrigger
                    id="view-options-pipeline-property"
                    className="bg-card text-card-foreground col-span-2 h-8"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="item-aligned">
                    {pipelineProperties.map((p) => (
                      <SelectItem key={p.key} value={p.key}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-3 items-center gap-4">
                <Label
                  variant="classic"
                  className="col-span-2"
                  htmlFor="view-options-hide-empty-columns"
                >
                  {t("web.contacts.views.hideEmptyColumnsLabel")}
                </Label>
                <div className="text-right">
                  <Switch
                    id="view-options-hide-empty-columns"
                    checked={view.hideEmptyColumns ?? false}
                    onCheckedChange={(value) =>
                      handleChange({ ...view, hideEmptyColumns: value })
                    }
                  />
                </div>
              </div>
            </>
          )}

          {hasUnsavedFilters && (
            <>
              <Separator className="-mx-4 w-auto" />
              <div className="-mx-3 -mb-2 -mt-1.5 flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    handleChange(baseView);
                  }}
                >
                  {t("web.contacts.views.actions.resetButton")}
                </Button>
                <SaveViewDialog
                  view={view}
                  onAfterSave={(savedView) => {
                    handleChange(savedView);
                  }}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-primary hover:text-primary ml-auto"
                  >
                    {t("web.contacts.views.actions.saveForEveryoneButton")}
                  </Button>
                </SaveViewDialog>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const options = [
  {
    value: "list",
    label: (t: TFunction) => t("web.contacts.views.type.list"),
    icon: ListIcon,
  },
  {
    value: "pipeline",
    label: (t: TFunction) => t("web.contacts.views.type.pipeline"),
    icon: Columns3Icon,
  },
];

function ModeSwitcher({
  value,
  onChange,
  onBlur,
}: {
  value: "list" | "pipeline";
  onChange?: (value: "list" | "pipeline") => void;
  onBlur?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <RadioGroup.Root
      defaultValue={value}
      className="grid w-full max-w-md grid-cols-2 gap-3"
      onValueChange={onChange}
      onBlur={onBlur}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            "ring-border group relative flex flex-col items-center justify-center gap-1.5 rounded border px-3 py-2",
            "data-[state=checked]:bg-card data-[state=checked]:border"
          )}
        >
          <option.icon className="group-data-[state=checked]:text-primary text-muted-foreground size-6" />
          <span className="text-sm">{option.label(t)}</span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
