import { getAuth } from "firebase/auth";
import { TFunction } from "i18next";
import * as z from "zod";

import { Property, SelectOption } from "@repo/core/types";

import { generateId } from "./utils";
import { zEmptyToNull } from "./zod";

export interface PropertyMetadata {
  name: string;
  createable?: boolean;
  getValueSchema(required: boolean): z.ZodType<any, any>;
  defaultValue: any | (() => any);
}

function getSchema(required: boolean, type: z.ZodTypeAny) {
  return zEmptyToNull(required ? type : type.nullish());
}

export const PROPERTY_METADATA: Record<
  Property["type"],
  Omit<PropertyMetadata, "name"> & { name: string }
> = {
  text: {
    name: "web.properties.types.text",
    createable: true,
    getValueSchema: (required) => getSchema(required, z.string()),
    defaultValue: "",
  },
  "single-select": {
    name: "web.properties.types.singleSelect",
    createable: true,
    getValueSchema: (required) => getSchema(required, z.string()),
    defaultValue: null,
  },
  "multi-select": {
    name: "web.properties.types.multiSelect",
    createable: true,
    getValueSchema: (required) => getSchema(required, z.array(z.string())),
    defaultValue: [],
  },
  "user-select": {
    name: "web.properties.types.userSelect",
    getValueSchema: (required) => getSchema(required, z.string()),
    defaultValue: () => getAuth().currentUser?.uid ?? null,
  },
  textarea: {
    name: "web.properties.types.textarea",
    getValueSchema: (required) => getSchema(required, z.string()),
    defaultValue: "",
  },
  url: {
    name: "web.properties.types.url",
    getValueSchema: (required) => getSchema(required, z.url()),
    defaultValue: "",
  },
  email: {
    name: "web.properties.types.email",
    getValueSchema: (required) => getSchema(required, z.email()),
    defaultValue: "",
  },
  tel: {
    name: "web.properties.types.tel",
    getValueSchema: (required) => getSchema(required, z.string()),
    defaultValue: "",
  },
  amount: {
    name: "web.properties.types.amount",
    getValueSchema: (required) => getSchema(required, z.number()),
    defaultValue: 0,
  },
};

export function getDefaultPipelineStages(t: TFunction): SelectOption[] {
  return [
    {
      label: t("web.defaultPipelineProperty.stage.lead"),
      value: generateId(),
      color: "gray",
    },
    {
      label: t("web.defaultPipelineProperty.stage.conversation"),
      value: generateId(),
      color: "blue",
    },
    {
      label: t("web.defaultPipelineProperty.stage.proposal"),
      value: generateId(),
      color: "yellow",
    },
    {
      label: t("web.defaultPipelineProperty.stage.negotiation"),
      value: generateId(),
      color: "orange",
    },
    {
      label: t("web.defaultPipelineProperty.stage.won"),
      value: generateId(),
      color: "green",
    },
  ];
}
