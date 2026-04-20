import * as z from "zod";

import { Property } from "@repo/core/types";

import { PROPERTY_METADATA } from "./properties";

z.config({
  customError: (issue) => {
    if (
      issue.code === "invalid_type" &&
      (issue.input === null ||
        issue.input === undefined ||
        issue.input === "null")
    ) {
      return "Required";
    }
  },
});

export function emptyToNull<T>(value: T): T | null {
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }
  if (Array.isArray(value) && value.length === 0) {
    return null;
  }
  if (value === undefined) {
    return null;
  }
  return value;
}

export function zEmptyToNull<T extends z.ZodType>(
  type: T
): z.ZodPipe<z.ZodTransform<z.output<T> | null, any>, T> {
  return z.preprocess(emptyToNull, type);
}

export function getPlainSchemaForProperties(
  properties: Array<Property>,
  { separator = "." }: { separator?: string } = {}
) {
  const schemaObject: Record<string, z.ZodTypeAny> = {};
  for (const property of properties) {
    if (property.readonly) continue;
    schemaObject[property.key.replaceAll(".", separator)] = PROPERTY_METADATA[
      property.type
    ].getValueSchema(property.required);
  }
  return z.object(schemaObject);
}

export function buildZodSchemaForProperties(properties: Array<Property>) {
  const schemaObject: Record<string, z.ZodTypeAny> = {};

  for (const property of properties) {
    if (property.readonly) continue;

    const keys = property.key.split(".");
    let currentObj = schemaObject;

    for (const [index, k] of keys.entries()) {
      if (index === keys.length - 1) {
        const schema = PROPERTY_METADATA[property.type].getValueSchema(
          property.required
        );
        currentObj[k] = schema;
      } else {
        if (!currentObj[k]) {
          currentObj[k] = z.object({});
        }
        currentObj = (currentObj[k] as z.ZodObject).shape;
      }
    }
  }

  return z.object(schemaObject);
}

function unwrapSchema(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return unwrapSchema(schema.unwrap() as z.ZodType);
  }
  return schema;
}

export function deepMergeZodObjects(
  schema1: z.ZodType,
  schema2: z.ZodType
): z.ZodType {
  const unwrappedSchema1 = unwrapSchema(schema1);
  const unwrappedSchema2 = unwrapSchema(schema2);

  // Handle base cases
  if (
    !(unwrappedSchema1 instanceof z.ZodObject) ||
    !(unwrappedSchema2 instanceof z.ZodObject)
  ) {
    return schema2;
  }

  const mergedShape: { [key: string]: z.ZodType } = {};

  // Merge properties from both schemas
  const allKeys = new Set([
    ...Object.keys(unwrappedSchema1.shape),
    ...Object.keys(unwrappedSchema2.shape),
  ]);

  for (const key of allKeys) {
    const field1 = unwrappedSchema1.shape[key];
    const field2 = unwrappedSchema2.shape[key];

    if (!field1) {
      mergedShape[key] = field2;
      // eslint-disable-next-line unicorn/no-negated-condition
    } else if (!field2) {
      mergedShape[key] = field1;
    } else {
      mergedShape[key] = deepMergeZodObjects(field1, field2);
    }
  }

  // Create the merged schema
  let mergedSchema: z.ZodType = z.object(mergedShape);

  // Handle optional
  if (schema1 instanceof z.ZodOptional || schema2 instanceof z.ZodOptional) {
    mergedSchema = mergedSchema.optional();
  }

  // Handle nullable
  if (schema1 instanceof z.ZodNullable || schema2 instanceof z.ZodNullable) {
    mergedSchema = mergedSchema.nullable();
  }

  return mergedSchema;
}
