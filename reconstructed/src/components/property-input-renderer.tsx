import { Dispatch, SetStateAction, useState } from "react";

import {
  MultiSelectProperty,
  Property,
  SelectOption,
  SingleSelectProperty,
  WorkspaceObjectType,
} from "@repo/core/types";

import { SocialMediaIcon } from "./contacts/social-media";
import { Badge } from "./ui/badge";
import { ColorBubble } from "./ui/color-bubble";
import { DeleteOptionButton } from "./ui/combobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { HideMainButton } from "./ui/main-button";
import { SelectOptionsInput } from "./ui/select/options-input";
import { AppFieldApi } from "@/hooks/app-form";
import { useProperties } from "@/hooks/useProperties";
import { generateId } from "@/lib/utils";

interface RenderPropertyInputOptions {
  property: Property;
  field: AppFieldApi;
  objectType: WorkspaceObjectType;
  variant?: "ghost";
}

// eslint-disable-next-line react-refresh/only-export-components
export function renderPropertyInput({
  property,
  field,
  objectType,
  variant,
}: RenderPropertyInputOptions) {
  const placeholder = property.placeholder ?? property.name;

  switch (property.type) {
    case "text":
      return (
        <field.TextInput
          variant={variant}
          type="text"
          placeholder={placeholder}
        />
      );
    case "textarea":
      return (
        <field.TextAreaInput
          variant={variant}
          rows={2}
          placeholder={placeholder}
        />
      );
    case "email":
      return (
        <field.TextInput
          variant={variant}
          type="email"
          placeholder={placeholder}
        />
      );
    case "tel":
      return (
        <field.TextInput
          variant={variant}
          type="tel"
          placeholder={placeholder}
        />
      );
    case "amount":
      return (
        <field.TextInput
          variant={variant}
          type="number"
          placeholder={placeholder}
          onChange={(e) => {
            const value = e.target.value;
            field.handleChange(value === "" ? "" : Number(value));
          }}
        />
      );
    case "url":
      return (
        <field.TextInputWithIcon
          variant={variant}
          type="url"
          placeholder={placeholder}
          endIcon={
            field.state.value ? (
              <SocialMediaIcon
                url={(field.state.value ?? "") as string}
                className="size-5"
              />
            ) : null
          }
          onChange={(e) => {
            field.handleChange(e.target.value);
            if (e.target.value) {
              const isValidProtocol =
                "https://".indexOf(e.target.value.slice(0, 8).toLowerCase()) ===
                  0 ||
                "http://".indexOf(e.target.value.slice(0, 7).toLowerCase()) ===
                  0;
              if (!isValidProtocol) {
                field.handleChange(`https://${e.target.value}`);
              }
            }
          }}
        />
      );
    case "single-select":
    case "multi-select":
      return (
        <ComboboxInput
          property={property}
          field={field}
          objectType={objectType}
          variant={variant}
        />
      );
    case "user-select":
      return (
        <field.UserSelectInput variant={variant} placeholder={placeholder} />
      );
    default:
      // @ts-expect-error there are no property types left
      console.warn(`Unknown property type: ${property.type}`);
      return <field.TextInput type="text" placeholder={placeholder} />;
  }
}

function ComboboxInput({
  id,
  property,
  field,
  objectType,
  variant,
}: RenderPropertyInputOptions & {
  id?: string;
  property: SingleSelectProperty | MultiSelectProperty;
}) {
  const [customProperties, updateCustomProperties] = useProperties(objectType);

  const updateOptions = (newOptions: SelectOption[]) => {
    const index = customProperties.findIndex((p) => p.key === property.key);
    if (index === -1) {
      return;
    }
    const prop = customProperties[index] as
      | SingleSelectProperty
      | MultiSelectProperty;

    const updatedProperty = {
      ...prop,
      options: newOptions,
    };
    const newProperties = customProperties.with(index, updatedProperty);
    updateCustomProperties(newProperties);
  };

  const toggleDefaultOption = (option: SelectOption) => {
    if (property.type !== "single-select") return;

    const index = customProperties.findIndex((p) => p.key === property.key);
    if (index === -1) {
      return;
    }
    const prop = customProperties[index] as SingleSelectProperty;

    const updatedProperty = {
      ...prop,
      defaultValue:
        prop.defaultValue === option.value ? undefined : option.value,
    };
    const newProperties = customProperties.with(index, updatedProperty);
    updateCustomProperties(newProperties);
  };

  const [customizeDialogOpen, setCustomizeDialogOpen] = useState(false);
  const hasColor = property.options?.some((option) => option.color);

  return (
    <>
      <field.ComboboxInput
        id={id}
        variant={variant}
        placeholder={property.placeholder ?? property.name}
        options={property.options}
        multiple={(property.type === "multi-select") as true}
        optional={!property.required as false}
        renderItem={
          hasColor
            ? (option, onDelete) =>
                property.type === "multi-select" ? (
                  <Badge
                    key={option.value}
                    shape="square"
                    variant={option.color ?? "secondary"}
                    className="whitespace-nowrap"
                  >
                    {option.label}
                    {onDelete && (
                      <DeleteOptionButton onDelete={() => onDelete(option)} />
                    )}
                  </Badge>
                ) : (
                  <Badge
                    key={option.value}
                    shape="square"
                    variant={option.color ?? "secondary"}
                    className="whitespace-nowrap"
                  >
                    {option.label}
                  </Badge>
                )
            : undefined
        }
        renderListItem={
          hasColor
            ? (option) => (
                <>
                  <ColorBubble color={option.color} /> {option.label}
                </>
              )
            : undefined
        }
        onCreate={
          property.customizable
            ? (newLabel) => {
                const id = generateId();
                updateOptions([
                  ...(property.options ?? []),
                  { value: id, label: newLabel },
                ]);
                if (property.type === "single-select") {
                  field.handleChange(id);
                } else {
                  field.handleChange([
                    ...((field.state.value as string[]) ?? []),
                    id,
                  ]);
                }
              }
            : undefined
        }
        onCustomize={
          property.customizable ? () => setCustomizeDialogOpen(true) : undefined
        }
      />
      <CustomizeOptionsDialog
        open={customizeDialogOpen}
        onOpenChange={setCustomizeDialogOpen}
        options={property.options}
        setOptions={updateOptions}
        defaultOption={
          property.type === "single-select" ? property.defaultValue : undefined
        }
        onToggleDefaultOption={
          property.type === "single-select" ? toggleDefaultOption : undefined
        }
      />
    </>
  );
}

export function CustomizeOptionsDialog({
  open,
  onOpenChange,
  options,
  setOptions,
  defaultOption,
  onToggleDefaultOption,
}: {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  options: SelectOption[];
  setOptions: (newOptions: SelectOption[]) => void;
  defaultOption?: string;
  onToggleDefaultOption?: (option: SelectOption) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[90vw] overflow-y-scroll rounded-lg sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="mb-3">Options</DialogTitle>
        </DialogHeader>
        <SelectOptionsInput
          value={options}
          onChange={setOptions}
          defaultOption={defaultOption}
          onToggleDefaultOption={onToggleDefaultOption}
        />
        <HideMainButton />
      </DialogContent>
    </Dialog>
  );
}
