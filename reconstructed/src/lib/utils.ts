import { type ClassValue, clsx } from "clsx";
import { customAlphabet } from "nanoid";
import { isEqual, isObject, isPlainObject } from "radashi";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function openExternalLink(e: React.MouseEvent) {
  e.preventDefault();
  const url = e.currentTarget.getAttribute("href");
  if (url) {
    window.open(url, "_blank");
  }
}

export const generateId = customAlphabet(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  21
);

/**
 * Flattens a deep object to a single dimension, converting the keys
 * to dot notation.
 */
export function crushObjects<T extends object>(value: T): object {
  if (!value) {
    return {};
  }
  return (function crushReducer(crushed: any, value: unknown, path: string) {
    if (isObject(value)) {
      for (const [prop, propValue] of Object.entries(value)) {
        crushReducer(crushed, propValue, path ? `${path}.${prop}` : prop);
      }
    } else {
      crushed[path] = value;
    }
    return crushed;
  })({}, value, "");
}

type NullToUndefined<T> = T extends null
  ? NonNullable<T> | undefined
  : T extends object
    ? { [K in keyof T]: NullToUndefined<T[K]> }
    : T;

export function nullToUndefinedRecursive<T>(obj: T): NullToUndefined<T> {
  if (obj === null) {
    return undefined as NullToUndefined<T>;
  }
  if (isPlainObject(obj)) {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [
        key,
        nullToUndefinedRecursive(value),
      ])
    ) as NullToUndefined<T>;
  }
  return obj as NullToUndefined<T>;
}

export function removeDefaultValues<T extends object>(
  obj: T,
  defaultObj: T
): Partial<T> {
  const result: Partial<T> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (!isEqual(value, defaultObj[key as keyof T])) {
      result[key as keyof T] = value;
    }
  }

  return result;
}

export const isIOS = /iPad|iPhone|iPod/.test(navigator.platform);
