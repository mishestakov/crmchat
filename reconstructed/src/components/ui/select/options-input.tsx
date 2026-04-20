import { revalidateLogic } from "@tanstack/react-form";
import {
  Bell,
  ClockAlertIcon,
  EllipsisIcon,
  GripVertical,
  PencilIcon,
  Plus,
  StarIcon,
  Trash,
} from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import {
  Fragment,
  PropsWithChildren,
  forwardRef,
  useCallback,
  useEffect,
  useState,
} from "react";
import { Trans, useTranslation } from "react-i18next";
import * as z from "zod";

import { SelectOption, colorSchema } from "@repo/core/types";

import { Alert, AlertDescription } from "../alert";
import { Badge } from "../badge";
import { Button } from "../button";
import { ColorBubble } from "../color-bubble";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../dropdown-menu";
import { Input } from "../input";
import { Switch } from "../switch";
import { Tip } from "../tooltip";
import { AnimateChangeInHeight } from "@/components/animate-height";
import { Form } from "@/components/form/form";
import {
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "@/components/ui/section";
import { useAppForm } from "@/hooks/app-form";
import { useDisabledVerticalSwipe } from "@/hooks/useDisabledVerticalSwipe";
import { cn, generateId } from "@/lib/utils";

interface SelectOptionsInputProps {
  value: SelectOption[];
  onChange: (options: SelectOption[]) => void;
  onEditStateChange?: (isEditing: boolean) => void;
  defaultOption?: string;
  onToggleDefaultOption?: (option: SelectOption) => void;
}

export const SelectOptionsInput = forwardRef<
  HTMLInputElement,
  SelectOptionsInputProps
>(
  (
    {
      value,
      onChange,
      onEditStateChange,
      defaultOption,
      onToggleDefaultOption,
    },
    ref
  ) => {
    const { t } = useTranslation();
    useDisabledVerticalSwipe();

    const options = value ?? [];

    const [createdOption, setCreatedOption] = useState<SelectOption | null>(
      null
    );
    const [editedOption, setEditedOption] = useState<SelectOption | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const handleAdd = () => {
      setCreatedOption({
        label: "",
        value: generateId(),
      });
      setEditedOption(null);
    };
    const handleEdit = (option: SelectOption) => {
      if (!isDragging) {
        setEditedOption({ ...option });
        setCreatedOption(null);
      }
    };
    const handleCancel = () => {
      setCreatedOption(null);
      setEditedOption(null);
    };
    const handleSave = (savedOption: SelectOption) => {
      if (createdOption) {
        onChange([...options, savedOption]);
      } else if (savedOption) {
        onChange(
          options.map((option) =>
            option.value === savedOption.value ? savedOption : option
          )
        );
      }
      handleCancel();
    };
    const handleDelete = () => {
      if (createdOption) {
        onChange(options.filter((o) => o.value !== createdOption.value));
      } else if (editedOption) {
        onChange(options.filter((o) => o.value !== editedOption.value));
      }
      handleCancel();
    };
    const isEditing = editedOption !== null || createdOption !== null;

    useEffect(() => {
      onEditStateChange?.(isEditing);
    }, [isEditing, onEditStateChange]);

    return (
      <div ref={ref}>
        <SectionItems asChild>
          <Reorder.Group
            axis="y"
            values={options}
            onReorder={onChange}
            as="div"
            className="border-input rounded-lg border"
          >
            {options.map((option) => (
              <Fragment key={option.value}>
                {editedOption?.value === option.value ? (
                  <OptionForm
                    option={editedOption}
                    onSave={handleSave}
                    onDelete={handleDelete}
                    onCancel={handleCancel}
                  />
                ) : (
                  <OptionItem
                    option={option}
                    isEditing={isEditing}
                    isDefault={defaultOption === option.value}
                    onEdit={() => handleEdit(option)}
                    onSave={handleSave}
                    onToggleDefault={
                      onToggleDefaultOption
                        ? () => onToggleDefaultOption(option)
                        : undefined
                    }
                    onDragStart={() => setIsDragging(true)}
                    onDragEnd={() =>
                      setTimeout(() => setIsDragging(false), 100)
                    }
                  />
                )}
              </Fragment>
            ))}
            {createdOption === null ? (
              <SectionItem
                className={cn(
                  "text-muted-foreground hover:text-foreground transition-all",
                  isEditing && "pointer-events-none opacity-40"
                )}
                icon={null}
                onClick={handleAdd}
              >
                <Plus className="size-4" />
                <SectionItemTitle>
                  {t("web.properties.form.newOption")}
                </SectionItemTitle>
              </SectionItem>
            ) : (
              <OptionForm
                option={createdOption}
                onSave={handleSave}
                onDelete={handleDelete}
                onCancel={handleCancel}
              />
            )}
          </Reorder.Group>
        </SectionItems>
      </div>
    );
  }
);

interface OptionItemProps {
  option: SelectOption;
  isEditing: boolean;
  isDefault: boolean;
  onEdit: () => void;
  onSave: (option: SelectOption) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onToggleDefault?: () => void;
}

const OptionItem = forwardRef<HTMLDivElement, OptionItemProps>(
  (
    {
      option,
      isEditing,
      isDefault,
      onEdit,
      onSave,
      onDragStart,
      onDragEnd,
      onToggleDefault,
    },
    ref
  ) => {
    const { t } = useTranslation();
    const controls = useDragControls();
    return (
      <SectionItem
        asChild
        className={cn(
          "group cursor-default transition-opacity",
          isEditing && "pointer-events-none opacity-40"
        )}
        icon={null}
      >
        <Reorder.Item
          ref={ref}
          id={option.value}
          value={option}
          dragListener={false}
          dragControls={controls}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          as="div"
        >
          <GripVertical
            className="text-muted-foreground size-4 cursor-grab"
            style={{ touchAction: "none" }}
            onPointerDown={(e) => controls.start(e)}
          />
          <SectionItemTitle>{option.label}</SectionItemTitle>
          <SectionItemValue>
            {option.daysUntilStale && (
              <Tip
                content={
                  <Trans
                    t={t}
                    i18nKey="web.properties.form.stalePeriod.tooltip"
                    values={{ days: option.daysUntilStale }}
                  />
                }
              >
                <span className="text-xs">
                  {t("web.properties.form.stalePeriod.shortInfo", {
                    days: option.daysUntilStale,
                  })}
                </span>
              </Tip>
            )}

            {isDefault && (
              <Tip
                content={
                  <div>
                    <strong className="font-medium">
                      {t("web.properties.form.defaultOption")}
                    </strong>
                    <p>{t("web.properties.form.defaultOptionDescription")}</p>
                  </div>
                }
              >
                <StarIcon className="size-4 fill-yellow-500 text-yellow-500" />
              </Tip>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger
                onClick={(e) => e.stopPropagation()}
                className="group/colorpicker flex items-center px-1 transition-transform hover:scale-110"
                title={t("web.properties.form.changeColor")}
              >
                <ColorBubble color={option.color} />
                <span className="sr-only">
                  {t("web.properties.form.changeColor")}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <ColorOptionList
                  onSelect={(color) => onSave({ ...option, color })}
                />
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger
                onClick={(e) => e.stopPropagation()}
                className="group/colorpicker flex items-center px-1 transition-transform hover:scale-110"
                title={t("web.properties.form.changeColor")}
              >
                <EllipsisIcon className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => onEdit()}>
                  <PencilIcon />
                  {t("web.properties.form.edit")}
                </DropdownMenuItem>
                <StalePeriodDialog option={option} onSave={onSave}>
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                    <ClockAlertIcon
                      className={cn(option.daysUntilStale && "text-primary")}
                    />
                    {t("web.properties.form.staleNotifications")}
                  </DropdownMenuItem>
                </StalePeriodDialog>
                {onToggleDefault && (
                  <DropdownMenuItem onSelect={() => onToggleDefault()}>
                    <StarIcon
                      className={cn(
                        isDefault && "fill-yellow-500 text-yellow-500"
                      )}
                    />
                    {isDefault
                      ? t("web.properties.form.removeDefault")
                      : t("web.properties.form.makeDefault")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ColorBubble color={option.color} />
                    {t("web.properties.form.changeColor")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      <ColorOptionList
                        onSelect={(color) => onSave({ ...option, color })}
                      />
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
          </SectionItemValue>
        </Reorder.Item>
      </SectionItem>
    );
  }
);

interface OptionFormProps {
  className?: string;
  option: SelectOption;
  onSave: (option: SelectOption) => void;
  onDelete: () => void;
  onCancel: () => void;
}

const OptionForm = forwardRef<HTMLInputElement, OptionFormProps>(
  ({ option, onSave, onDelete, onCancel, className }, ref) => {
    const { t } = useTranslation();
    const [label, setLabel] = useState(option.label);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setLabel(e.target.value);
    };

    const handleSave = useCallback(() => {
      if (label.trim().length > 0) {
        onSave({ ...option, label: label.trim() });
      }
    }, [label, onSave, option]);

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        handleSave();
      } else if (e.key === "Escape") {
        onCancel();
      }
    };

    return (
      <div className={cn("relative w-full", className)}>
        <Input
          ref={ref}
          type="text"
          value={label}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          placeholder={t("web.properties.form.newOption")}
          className="min-h-11 flex-grow border-0 py-3 pl-10 pr-36 font-medium"
          autoFocus
          autoComplete="off"
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-2">
          <Button
            type="button"
            className="text-muted-foreground hover:text-destructive flex size-7 items-center justify-center p-0"
            variant="outline"
            onClick={onDelete}
          >
            <Trash className="size-4 shrink-0 cursor-pointer" />
            <span className="sr-only">
              {t("web.properties.form.deleteOption")}
            </span>
          </Button>
          <Button
            type="button"
            className="h-7 px-4 py-0"
            onClick={handleSave}
            disabled={label.trim().length === 0}
          >
            {t("web.properties.form.saveOption")}
          </Button>
        </div>
      </div>
    );
  }
);

const StaleSchema = z.object({
  daysUntilStale: z.number().min(1, "Should be greater than 0").default(2),
});

function StalePeriodDialog({
  option,
  onSave,
  children,
}: PropsWithChildren<{
  option: SelectOption;
  onSave: (option: SelectOption) => void;
}>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const [enabled, setEnabled] = useState(!!option.daysUntilStale);

  const form = useAppForm({
    defaultValues: {
      daysUntilStale: option.daysUntilStale ?? 2,
    } as z.input<typeof StaleSchema>,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: StaleSchema,
    },
    onSubmit: (e) => {
      const data = StaleSchema.parse(e.value);
      onSave({
        ...option,
        daysUntilStale: enabled ? data.daysUntilStale : undefined,
      });
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-[400px] sm:max-w-[400px]">
        <Form form={form} className="flex flex-col">
          <DialogHeader>
            <DialogTitle className="mb-6 flex items-center justify-start space-x-1">
              <Switch
                id="enabled"
                className="mr-2"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
              <label htmlFor="enabled">
                {t("web.properties.form.stalePeriod.titleSwitch")}
              </label>
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-foreground text-normal" asChild>
            <Alert className="mb-6">
              <Bell className="size-4" />
              <AlertDescription>
                <form.Subscribe
                  selector={(state) => state.values.daysUntilStale}
                  children={(daysUntilStale) => (
                    <Trans
                      t={t}
                      i18nKey="web.properties.form.stalePeriod.description"
                      values={{
                        option: option.label,
                        days: enabled ? daysUntilStale : "N",
                      }}
                      components={[
                        <Badge
                          variant="secondary"
                          className="whitespace-nowrap"
                          shape="inline"
                        />,
                      ]}
                    />
                  )}
                />
              </AlertDescription>
            </Alert>
          </DialogDescription>
          <AnimateChangeInHeight>
            <form.AppField
              name="daysUntilStale"
              children={(field) => (
                <field.FormItem
                  className={cn("space-y-0 pb-6", !enabled && "hidden")}
                >
                  <div className="flex flex-row items-center gap-4">
                    <field.FormLabel
                      htmlFor="daysInput"
                      className="ml-2 shrink-0"
                      variant="classic"
                    >
                      {t(
                        "web.properties.form.stalePeriod.sendNotificationEvery"
                      )}
                    </field.FormLabel>
                    <field.TextInputWithIcon
                      id="daysInput"
                      type="text"
                      pattern="\d*"
                      endIcon={
                        <span>{t("web.properties.form.stalePeriod.days")}</span>
                      }
                      disabled={!enabled}
                      onChange={(e) => field.setValue(Number(e.target.value))}
                    />
                  </div>
                  <field.FormMessage className="ml-2" />
                </field.FormItem>
              )}
            />
          </AnimateChangeInHeight>
          <DialogFooter>
            <form.SubmitButton>
              {t("web.properties.form.stalePeriod.save")}
            </form.SubmitButton>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ColorOptionList({
  onSelect,
}: {
  onSelect: (color: SelectOption["color"]) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <DropdownMenuItem onSelect={() => onSelect(undefined)}>
        {t(`web.colors.none`)}
      </DropdownMenuItem>
      {colorSchema.options.map((color) => (
        <DropdownMenuItem key={color} onSelect={() => onSelect(color)}>
          <ColorBubble color={color} />
          {t(`web.colors.color_${color}`)}
        </DropdownMenuItem>
      ))}
    </>
  );
}
