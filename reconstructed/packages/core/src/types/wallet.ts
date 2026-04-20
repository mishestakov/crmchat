import * as z from "zod";

import { Timestamp, WithId, timestampField } from "./common";

export const CREDIT_SCALE = 100; // 1 credit = 100 units

export const WalletSchema = z.object({
  balanceUnits: z.number(),
  updatedAt: timestampField(),
});

export type Wallet = z.infer<typeof WalletSchema>;

export interface WalletTransaction {
  createdAt: Timestamp;
  /**
   * Amount in minor units
   * +credit (topup/refund), -debit (spend/chargeback)
   *
   * @see {@link CREDIT_SCALE}
   */
  amountUnits: number;
  kind: "topup" | "spend" | "refund" | "adjust";
  status: "posted";
  idempotencyKey: string;
  /** system-user or uid */
  actor: "system-user" | (string & {});
  /** Reason code for the transaction */
  reason?:
    | "welcomeBonus"
    | "stripeTopup"
    | "phoneNumbersConverter"
    | "lookalikeAudience"
    | "groupParser";

  refundedByTransactionId?: string;
  refundForTransactionId?: string;

  metadata?: {
    stripeCheckoutSessionId?: string;
  };
}

export type WalletTransactionWithId = WithId<WalletTransaction> & {
  organizationId: string;
};
