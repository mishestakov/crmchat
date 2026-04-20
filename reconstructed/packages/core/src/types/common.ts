import * as z from "zod";

export interface Timestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
  isEqual(other: Timestamp): boolean;
  toString(): string;
  valueOf(): string;
}

export type DistributiveOmit<T, K extends keyof any> = T extends any
  ? Omit<T, K>
  : never;

export type WithId<T> = T & { id: string };

export type TimestampsToDate<T> = T extends { toDate(): Date }
  ? Date
  : T extends (infer U)[]
    ? TimestampsToDate<U>[]
    : T extends object
      ? { [K in keyof T]: TimestampsToDate<T[K]> }
      : T;

export const CustomPropertyValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

export const timestampField = () =>
  z
    .custom<Timestamp>(
      (val): val is Timestamp =>
        val !== null &&
        typeof val === "object" &&
        "toDate" in (val as object) &&
        typeof (val as Timestamp).toDate === "function"
    )
    .meta({ timestamp: true });
