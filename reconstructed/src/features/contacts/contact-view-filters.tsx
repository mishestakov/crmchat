import { Link } from "@tanstack/react-router";
import {
  CheckCircle2Icon,
  CheckIcon,
  ExpandIcon,
  ListFilterIcon,
  PlusIcon,
  SearchIcon,
  Settings2Icon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, m, motion } from "motion/react";
import { debounce, isEqual, omit } from "radashi";
import { forwardRef, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  MultiSelectProperty,
  SelectOption,
  SingleSelectProperty,
  UserSelectProperty,
} from "@repo/core/types";

import { AnimateChangeInHeight } from "../../components/animate-height";
import { Button, ButtonProps } from "../../components/ui/button";
import { ColorBubble } from "../../components/ui/color-bubble";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { InputWithIcon } from "../../components/ui/input";
import Loader from "../../components/ui/loader";
import { ScrollArea, ScrollBar } from "../../components/ui/scroll-area";
import { normalizeViewOptions } from "./use-view-options";
import { ViewSelector } from "./view-selector";
import { useViewContext } from "./views/view-context";
import { ViewDisplayOptions } from "@/features/contacts/display-options";
import { useProperties } from "@/hooks/useProperties";
import { useView } from "@/hooks/useViews";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { useCurrentWorkspace } from "@/lib/store";
import { isWideScreenWebApp } from "@/lib/telegram";
import { cn } from "@/lib/utils";

type FilterableProperty =
  | SingleSelectProperty
  | MultiSelectProperty
  | UserSelectProperty;

// eslint-disable-next-line react-refresh/only-export-components
export const NO_VALUE_OPTION: SelectOption = {
  label: "No Value",
  value: "__no_value__",
};

export function ContactViewFilters({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [properties] = useProperties("contacts");

  const {
    view,
    onViewSelect,
    onViewOptionsChange,
    isSelectionMode,
    setIsSelectionMode,
  } = useViewContext();

  const baseView = useView("contacts", view.id);

  const hasUnsavedFilters = useMemo(() => {
    return !isEqual(
      omit(normalizeViewOptions(view), ["q"]),
      omit(normalizeViewOptions(baseView), ["q"])
    );
  }, [view, baseView]);

  return (
    <div
      className={cn(
        "flex w-full flex-col",
        view.type === "pipeline" &&
          "@desktop:flex-row @desktop:items-center @desktop:gap-2",
        className
      )}
    >
      <div
        className={cn(
          "mb-3 flex items-center",
          view.type === "pipeline" && "@desktop:mb-0"
        )}
      >
        <ViewSelector
          className={cn(
            "border-border rounded-lg rounded-r-none border-r font-normal",
            view.type === "pipeline" && "@desktop:h-8 @desktop:rounded-l-full"
          )}
          value={view.id}
          onSelect={(selectedView) => onViewSelect(selectedView)}
        />
        <SearchInput
          className={cn(
            "w-full rounded-lg rounded-l-none",
            view.type === "pipeline" &&
              "@desktop:h-8 @desktop:w-48 @desktop:rounded-r-full"
          )}
          value={view.q ?? ""}
          onChange={(query) => onViewOptionsChange({ ...view, q: query })}
        />
      </div>

      <div className="grow overflow-hidden">
        <ScrollArea className="whitespace-nowrap" type="hover">
          <div
            className={cn(
              "flex w-full items-center pb-3",
              view.type === "pipeline" && "@desktop:justify-end @desktop:pb-0"
            )}
          >
            {setIsSelectionMode && (
              <SelectionToggleButton
                isSelectionMode={isSelectionMode}
                setIsSelectionMode={setIsSelectionMode}
              />
            )}
            {Object.entries(view.filters).map(([propertyKey, values]) => {
              const property = properties.find((p) => p.key === propertyKey) as
                | FilterableProperty
                | undefined;
              if (!property) {
                return null;
              }
              return (
                <PropertyFilterMenu
                  key={property.key}
                  property={property}
                  values={values}
                  onChange={(v) => {
                    if (v === null) {
                      const hasInBaseView = Object.entries(
                        baseView.filters ?? {}
                      ).some(
                        ([key, value]) =>
                          key === property.key && value.length > 0
                      );
                      onViewOptionsChange({
                        ...view,
                        filters: hasInBaseView
                          ? {
                              ...view.filters,
                              [property.key]: [],
                            }
                          : omit(view.filters, [property.key]),
                      });
                    } else {
                      onViewOptionsChange({
                        ...view,
                        filters: {
                          ...view.filters,
                          [property.key]: v,
                        },
                      });
                    }
                  }}
                  includeNoValueOption={property.key !== "ownerId"}
                />
              );
            })}
            <AddFilterMenu
              selected={Object.keys(view.filters ?? {})}
              onSelect={(key) =>
                onViewOptionsChange({
                  ...view,
                  filters: { ...view.filters, [key]: [] },
                })
              }
            />

            <ViewDisplayOptions
              view={view}
              onChange={(v) => onViewOptionsChange({ ...view, ...v })}
              onReset={() => onViewOptionsChange(baseView)}
              hasUnsavedFilters={hasUnsavedFilters}
            >
              <FilterButton className="relative size-8 p-0">
                <Settings2Icon className="text-muted-foreground size-4" />
                <span className="sr-only">
                  {t("web.contacts.views.displayOptionsButton")}
                </span>
                {hasUnsavedFilters && (
                  <span className="bg-primary absolute right-1 top-1 size-1.5 rounded-full" />
                )}
              </FilterButton>
            </ViewDisplayOptions>

            <i className="ml-auto" />

            {isWideScreenWebApp && (
              <FilterButton
                onClick={() => {
                  const url = `${import.meta.env.VITE_APP_URL}#tgWebAppData=${encodeURIComponent(
                    window.Telegram?.WebApp.initData ?? ""
                  )}`;
                  window.open(url);
                }}
              >
                <ExpandIcon className="text-muted-foreground size-3" />
                {t("web.openInBrowser")}
              </FilterButton>
            )}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    </div>
  );
}
function SearchInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const debounceOnChange = debounce({ delay: 500 }, onChange);

  const handleInputChange = (inputValue: string) => {
    setLocalValue(inputValue);
    debounceOnChange(inputValue);
  };

  return (
    <InputWithIcon
      className={cn(
        "bg-card hover:bg-card/70 h-10 w-full rounded-lg border-none transition-colors",
        className
      )}
      startIcon={
        <SearchIcon className="text-muted-foreground size-4 shrink-0" />
      }
      endIcon={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "text-muted-foreground hover:text-muted-foreground/70 size-7 shrink-0",
            { invisible: localValue === "" }
          )}
          onClick={() => onChange("")}
        >
          <XIcon className="size-4" />
          <span className="sr-only">{t("web.contacts.filters.clear")}</span>
        </Button>
      }
      placeholder={t("web.contacts.filters.search")}
      value={localValue}
      onChange={(e) => handleInputChange(e.target.value)}
    />
  );
}

function getPropertyFilterMenuId(property: FilterableProperty) {
  return `property-filter-menu-${property.key}`;
}

export function PropertyFilterMenu({
  property,
  values,
  onChange,
  includeNoValueOption = false,
}: {
  property: FilterableProperty;
  values: string[];
  onChange: (values: string[] | null) => void;
  includeNoValueOption?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { members, isPending: membersPending } = useWorkspaceMembers();

  const options: SelectOption[] = useMemo(
    () =>
      property.type === "user-select"
        ? (members?.map(
            (m) =>
              ({
                label: m.user.name,
                value: m.userId,
              }) satisfies SelectOption
          ) ?? [])
        : property.options,
    [members, property]
  );

  const optionsWithNoValue = useMemo(
    () => (includeNoValueOption ? [NO_VALUE_OPTION, ...options] : options),
    [includeNoValueOption, options]
  );
  const hasColor = useMemo(() => options.some((o) => o.color), [options]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(_open) => {
        if (!_open && values.length === 0) {
          onChange(null);
        }
        setOpen(_open);
      }}
      modal
    >
      <DropdownMenuTrigger asChild>
        <FilterButton
          id={getPropertyFilterMenuId(property)}
          className="text-muted-foreground block"
        >
          {property.name}
          {values.length > 0 ? ": " : ""}
          {optionsWithNoValue
            .filter((o) => values.includes(o.value))
            .map((o, i) => (
              <span key={o.value}>
                {i === 0
                  ? ""
                  : i === values.length - 1
                    ? ` ${t("web.or")} `
                    : `, `}
                <span
                  className={cn("text-foreground", {
                    italic: o.value === NO_VALUE_OPTION.value,
                  })}
                >
                  {o.label}
                </span>
              </span>
            ))}
        </FilterButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[200px]"
        align="start"
        onFocusOutside={(e) => e.preventDefault()}
      >
        <AnimateChangeInHeight>
          <DropdownMenuGroup>
            {property.type === "user-select" && membersPending && (
              <div className="flex items-center justify-center p-3 pt-5">
                <Loader className="size-4" />
              </div>
            )}

            {optionsWithNoValue.map((option) => {
              const selected = values.includes(option.value);
              return (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={(e) => {
                    e.preventDefault();
                    onChange(
                      selected
                        ? values.filter((v) => v !== option.value)
                        : [...values, option.value]
                    );
                  }}
                  className={cn({
                    "text-foreground/50 italic":
                      option.value === NO_VALUE_OPTION.value,
                  })}
                >
                  <CheckIcon
                    className={cn(
                      "text-foreground size-4",
                      selected ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {hasColor && <ColorBubble color={option.color} />}
                  {option.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        </AnimateChangeInHeight>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="group"
          onSelect={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          <XIcon className="text-muted-foreground group-hover:text-foreground size-4 transition-colors" />
          {t("web.contacts.filters.removeFilter")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AddFilterMenu({
  selected,
  onSelect,
  label,
}: {
  selected: string[];
  onSelect: (key: string) => void;
  label?: string;
}) {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const [customProperties] = useProperties("contacts");
  const availableProperties = customProperties.filter(
    (p): p is FilterableProperty =>
      (p.type === "single-select" ||
        p.type === "multi-select" ||
        p.type === "user-select") &&
      !selected.includes(p.key)
  );
  if (selected.length > 0 && availableProperties.length === 0) {
    return null;
  }
  return (
    <DropdownMenu modal>
      <DropdownMenuTrigger asChild>
        <FilterButton>
          <ListFilterIcon className="text-muted-foreground size-4" />
          {label ?? t("web.contacts.filters.addFilter")}
        </FilterButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        {availableProperties.map((property) => (
          <DropdownMenuItem
            key={property.key}
            onClick={() => {
              onSelect(property.key);
              setTimeout(() => {
                document
                  // eslint-disable-next-line unicorn/prefer-query-selector
                  .getElementById(getPropertyFilterMenuId(property))
                  ?.click();
              }, 200);
            }}
          >
            {property.name}
          </DropdownMenuItem>
        ))}
        {availableProperties.length === 0 && (
          <>
            <DropdownMenuItem disabled>
              {t("web.contacts.filters.noCustomProperties")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link
                to="/w/$workspaceId/settings/properties/$objectType"
                params={{ workspaceId, objectType: "contacts" }}
              >
                <PlusIcon />
                {t("web.contacts.filters.createProperty")}
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const FilterButton = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <Button
        size="xs"
        variant="secondary"
        className={cn(
          "bg-card hover:bg-card/70 data-[state=open]:border-ring focus-visible:border-ring mr-1.5 gap-1 rounded-full border-2 border-transparent px-2 last:mr-0 focus-visible:ring-transparent",
          className
        )}
        ref={ref}
        {...props}
        asChild
      >
        <m.button layout="position">{children}</m.button>
      </Button>
    );
  }
);

function SelectionToggleButton({
  isSelectionMode,
  setIsSelectionMode,
}: {
  isSelectionMode: boolean | undefined;
  setIsSelectionMode: (isSelectionMode: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <FilterButton
      onClick={() => setIsSelectionMode(!isSelectionMode)}
      className={cn("gap-0", isSelectionMode && "text-destructive")}
    >
      {isSelectionMode ? (
        <XIcon className="size-4" />
      ) : (
        <CheckCircle2Icon className="text-muted-foreground size-4" />
      )}
      <AnimatePresence>
        {isSelectionMode && (
          <motion.span
            initial={{ width: 0 }}
            animate={{ width: "auto" }}
            exit={{ width: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <span className="ml-1">{t("web.cancel")}</span>
          </motion.span>
        )}
      </AnimatePresence>
      {!isSelectionMode && (
        <span className="sr-only">{t("web.contacts.filters.select")}</span>
      )}
    </FilterButton>
  );
}
