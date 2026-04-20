import { VariantProps, cva } from "class-variance-authority";
import { defaultFilter } from "cmdk";
import { ChevronsUpDown, Plus, Settings2, X } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "./badge";
import { Checkbox } from "./checkbox";
import { inputVariants } from "./input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface Option {
  value: string;
  label: string;
  separator?: boolean;
}

type BaseComboboxProps<TOption extends Option> = {
  children?: React.ReactNode;
  options: TOption[];
  noun?: [string, string];
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  renderItem?: (
    option: TOption,
    onDelete?: (option: TOption) => void
  ) => React.ReactNode;
  renderListItem?: (option: TOption) => React.ReactNode;
  renderNothingFound?: () => React.ReactNode;
  onBlur?: () => void;

  onCreate?: (value: string) => void;
  onCustomize?: () => void;
} & VariantProps<typeof comboboxVariants>;

type SingleRequiredComboboxProps<TOption extends Option> =
  BaseComboboxProps<TOption> & {
    multiple?: false;
    optional?: false;
    value: string | null; // allow null as initial value
    onChange: (value: string) => void;
  };

type SingleOptionalComboboxProps<TOption extends Option> =
  BaseComboboxProps<TOption> & {
    multiple?: false;
    optional: true;
    value: string | null;
    onChange: (value: string | null) => void;
  };

export type SingleComboboxProps<TOption extends Option> =
  | SingleRequiredComboboxProps<TOption>
  | SingleOptionalComboboxProps<TOption>;

type MultipleOnChange = (
  value: string[],
  change: { added: string[]; removed: string[] }
) => void;

export type MultipleComboboxProps<TOption extends Option> =
  BaseComboboxProps<TOption> & {
    multiple: true;
    optional?: false;
    value: string[];
    onChange: MultipleOnChange;
  };

export type ComboboxProps<TOption extends Option> =
  | SingleRequiredComboboxProps<TOption>
  | SingleOptionalComboboxProps<TOption>
  | MultipleComboboxProps<TOption>;

const ALMOST_ZERO = Math.pow(10, -10);

const comboboxVariants = cva(
  cn(
    inputVariants(),
    "flex h-auto items-center gap-2",
    "data-[state=open]:ring-ring data-[state=open]:outline-none data-[state=open]:ring-2 data-[state=open]:ring-offset-2"
  ),
  {
    variants: {
      variant: {
        default: "",
        ghost:
          "hover:border-input hover:bg-card border-transparent bg-transparent [&_.chevron]:opacity-0 [&_.chevron]:hover:opacity-100",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export const Combobox = React.forwardRef(function Combobox<
  TOption extends Option = Option,
>(
  {
    children,
    value,
    onChange,
    multiple = false,
    optional = false,
    options,
    id,
    disabled = false,
    placeholder,
    className,
    variant,
    renderItem,
    renderListItem,
    renderNothingFound,
    onBlur,
    onCreate,
    onCustomize,
  }: ComboboxProps<TOption>,
  ref: React.ForwardedRef<HTMLButtonElement>
): React.ReactElement<any> {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState("");

  const showCreateItem =
    onCreate &&
    searchValue.trim() !== "" &&
    options.every(
      (o) => o.label.toLowerCase() !== searchValue.trim().toLowerCase()
    );

  const closePopover = () => {
    setOpen(false);
    onBlur?.();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setOpen(true);
        } else {
          closePopover();
        }
      }}
    >
      <PopoverTrigger asChild>
        {children ?? (
          <button
            ref={ref}
            id={id}
            role="combobox"
            aria-expanded={open}
            className={cn(comboboxVariants({ variant }), className)}
            disabled={disabled}
          >
            {multiple ? (
              <MultipleView
                value={value as string[]}
                options={options}
                onChange={onChange as MultipleOnChange}
                placeholder={placeholder}
                renderItem={renderItem}
              />
            ) : (
              <SingleView
                value={value as string}
                options={options}
                placeholder={placeholder}
                renderItem={renderItem}
              />
            )}
            <ChevronsUpDown className="chevron ml-auto h-4 w-4 shrink-0 opacity-50" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        className="max-h-[var(--radix-popover-content-available-height)] min-w-[var(--radix-popover-trigger-width)] overflow-hidden p-0"
        collisionPadding={5}
      >
        <Command
          filter={(value, search, keywords) => {
            if (value.startsWith("__")) return ALMOST_ZERO;
            return defaultFilter(value, search, keywords!);
          }}
        >
          <CommandInput
            placeholder={t("web.combobox.search")}
            value={searchValue}
            onValueChange={(value) => setSearchValue(value)}
          />
          <CommandList>
            <CommandEmpty>
              {renderNothingFound?.() ?? t("web.combobox.nothingFound")}
            </CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = multiple
                  ? ((value ?? []) as string[]).includes(option.value)
                  : value === option.value;

                const handleSelect = () => {
                  if (multiple) {
                    (onChange as MultipleOnChange)(
                      isSelected
                        ? ((value ?? []) as string[]).filter(
                            (v) => v !== option.value
                          )
                        : [...((value ?? []) as string[]), option.value],
                      {
                        added: isSelected ? [] : [option.value],
                        removed: isSelected ? [option.value] : [],
                      }
                    );
                  } else if (optional) {
                    (onChange as (value: string | null) => void)(
                      isSelected ? null : option.value
                    );
                  } else {
                    if (!isSelected) {
                      (onChange as (value: string) => void)(option.value);
                    }
                  }
                };

                if (option.separator) {
                  return (
                    <CommandSeparator key={option.value} className="my-1" />
                  );
                }

                return (
                  <CommandItem
                    className="group flex items-center gap-2 px-2 py-1.5"
                    key={option.value}
                    value={option.value}
                    keywords={[option.label]}
                    onSelect={() => {
                      handleSelect();
                      closePopover();
                    }}
                  >
                    <div
                      className="-mx-2 -my-1.5 flex h-full cursor-pointer items-center px-2 py-1.5"
                      onClick={(e) => {
                        if (multiple) {
                          e.stopPropagation();
                          handleSelect();
                        }
                      }}
                    >
                      <Checkbox
                        tabIndex={-1}
                        className={cn(
                          "hover:!border-primary data-[state=unchecked]:border-muted-foreground/50 data-[state=unchecked]:opacity-0",
                          multiple
                            ? "group-hover:data-[state=unchecked]:opacity-100"
                            : "pointer-events-none"
                        )}
                        checked={isSelected}
                      />
                    </div>
                    {renderListItem?.(option) ??
                      renderItem?.(option) ??
                      option.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>

            {(showCreateItem || onCustomize) && (
              <>
                <CommandSeparator alwaysRender />
                <CommandGroup>
                  {showCreateItem && (
                    <CommandItem
                      className="px-2 py-1.5"
                      value="__create_item"
                      onSelect={() => onCreate?.(searchValue.trim())}
                    >
                      <Plus className="mr-2 size-4" />
                      {t("web.combobox.create", { value: searchValue.trim() })}
                    </CommandItem>
                  )}
                  {onCustomize && !showCreateItem && (
                    <CommandItem
                      className="px-2 py-1.5"
                      value="__customize"
                      onSelect={() => onCustomize?.()}
                    >
                      <Settings2 className="mr-2 size-4" />
                      {t("web.combobox.customize")}
                    </CommandItem>
                  )}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}) as <TOption extends Option = Option>(
  props: ComboboxProps<TOption> & { ref?: React.Ref<HTMLButtonElement> }
) => React.ReactElement<any>;

function SingleView<TOption extends Option>({
  value,
  options,
  placeholder,
  renderItem,
}: Pick<
  SingleComboboxProps<TOption>,
  "value" | "options" | "placeholder" | "renderItem"
>) {
  const item = options.find((option) => option.value === value);
  if (!value || !item) {
    return <span className="text-muted-foreground">{placeholder}</span>;
  }

  return (
    <>
      {renderItem?.(item) ?? (
        <span className="truncate whitespace-nowrap">{item.label}</span>
      )}
    </>
  );
}

function MultipleView<TOption extends Option>({
  value,
  options,
  onChange,
  placeholder,
  renderItem,
}: Pick<
  MultipleComboboxProps<TOption>,
  "value" | "options" | "onChange" | "placeholder" | "renderItem"
>) {
  if (!value || value.length === 0) {
    return <span className="text-muted-foreground">{placeholder}</span>;
  }

  const onDelete = (option: TOption) => {
    onChange(
      (value as string[]).filter((v) => v !== option.value),
      {
        added: [],
        removed: [option.value],
      }
    );
  };

  return (
    <div className="flex flex-wrap gap-1">
      {options
        .filter((option) => value?.includes(option.value))
        .map(
          (option) =>
            renderItem?.(option, onDelete) ?? (
              <Badge
                key={option.value}
                shape="square"
                variant="secondary"
                className="whitespace-nowrap"
              >
                {option.label}
                <DeleteOptionButton onDelete={() => onDelete(option)} />
              </Badge>
            )
        )}
    </div>
  );
}

export function DeleteOptionButton({ onDelete }: { onDelete: () => void }) {
  return (
    <span
      role="button"
      className="ring-offset-background focus:ring-ring ml-1 rounded-full outline-none focus:ring-2 focus:ring-offset-2"
      onClick={() => onDelete()}
    >
      <X className="text-muted-foreground hover:text-foreground h-3 w-3" />
    </span>
  );
}
