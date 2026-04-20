import { CREDIT_SCALE } from "../types/wallet";

export const toWalletUnits = (credits: number) =>
  Math.round(credits * CREDIT_SCALE);
export const fromWalletUnits = (units: number) => units / CREDIT_SCALE;
export const decimals = Math.log10(CREDIT_SCALE); // for formatting (3)
