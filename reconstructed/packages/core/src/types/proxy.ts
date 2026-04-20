import * as z from "zod";

import { Timestamp, WithId } from "./common";

export const ProviderSchema = z.enum([
  "proxy6net",
  "proxymarket",
  "proxyline",
  "internal",
]);

export interface Proxy {
  countryCode: string;
  status: "active" | "unavailable";
  type: "https";
  /** @default "ipv6"  */
  version?: "ipv4" | "ipv6";
  host: string;
  port: number;
  username: string;
  password: string;

  createdAt: Timestamp;
  expiresAt: Timestamp;

  provider: z.infer<typeof ProviderSchema>;
  providerId: string;
}

export type ProxyWithId = WithId<Proxy>;
