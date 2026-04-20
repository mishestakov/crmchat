import { get } from "radashi";

export const NO_VALUE_FILTER = "__no_value__";

export type Filters = {
  [propertyKey: string]: string[];
};

export function doesObjectSatisfyFilters(object: any, filters: Filters) {
  for (const [key, filterValues] of Object.entries(filters)) {
    if (filterValues.length === 0) {
      continue;
    }
    const value = get(object, key, undefined) as any;
    const hasNoValue = filterValues.includes(NO_VALUE_FILTER);
    const isEmpty =
      value === undefined ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === "string" && value.trim() === "");

    if (isEmpty) {
      if (hasNoValue) {
        continue;
      } else {
        return false;
      }
    }

    const normalValues = filterValues.filter((v) => v !== NO_VALUE_FILTER);
    if (Array.isArray(value)) {
      if (normalValues.length === 0) {
        return false;
      }
      if (!value.some((v) => normalValues.includes(v))) {
        return false;
      }
    } else {
      if (normalValues.length === 0) {
        return false;
      }
      if (!normalValues.includes(value)) {
        return false;
      }
    }
  }

  return true;
}
