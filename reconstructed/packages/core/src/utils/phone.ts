import {
  isValidPhoneNumber as libIsValid,
  parsePhoneNumberWithError,
} from "libphonenumber-js";

/**
 * Strips formatting characters from a phone number.
 * Returns raw digits only (no validation).
 * Used for comparison purposes.
 */
export function normalizePhoneNumber(phone: string): string {
  phone = phone.trim().replaceAll(/[+()\s-]/g, "");
  if (!/^\d+$/.test(phone)) return "";
  return phone;
}

/**
 * Normalizes a phone number to E.164 format.
 * Adds + prefix if missing.
 * Returns null if the phone number is invalid.
 */
export function normalizePhoneToE164(raw: string): string | null {
  if (!raw || raw.trim() === "") {
    return null;
  }

  // Strip spaces, dashes, parentheses
  const cleaned = raw.replaceAll(/[\s\-()]/g, "");

  // Add + prefix if missing
  const normalized = cleaned.startsWith("+") ? cleaned : `+${cleaned}`;

  try {
    if (!libIsValid(normalized)) {
      return null;
    }
    return parsePhoneNumberWithError(normalized).format("E.164");
  } catch {
    return null;
  }
}

/**
 * Checks if a phone number is valid E.164 format.
 */
export function isValidE164Phone(phone: string): boolean {
  return normalizePhoneToE164(phone) !== null;
}
