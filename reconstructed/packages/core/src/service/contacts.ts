import { get, set } from "radashi";
import { SetOptional } from "type-fest";

import { Contact, Property } from "../types";

type InputContact = SetOptional<
  Contact,
  "createdAt" | "createdBy" | "updatedAt" | "workspaceId"
>;

export function getPatchForDefaultValues(
  contact: InputContact,
  properties: Property[]
) {
  const patch: Record<string, any> = {};
  for (const property of properties) {
    if ("defaultValue" in property && property.defaultValue) {
      if ("options" in property) {
        const hasOption = property.options.some(
          (o) => o.value === property.defaultValue
        );
        if (!hasOption) {
          continue;
        }
      }
      const currentValue = get(contact, property.key);
      if (!currentValue) {
        patch[property.key] = property.defaultValue;
      }
    }
  }
  return patch;
}

export function withDefaultValues<T extends InputContact>(
  contact: T,
  properties: Property[]
): T {
  let data = { ...contact };
  for (const [key, value] of Object.entries(
    getPatchForDefaultValues(contact, properties)
  )) {
    data = set(data, key, value);
  }
  return data;
}
