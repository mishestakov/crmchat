import {
  createTRPCClient,
  httpBatchLink,
  httpLink,
  splitLink,
} from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { createTRPCContext } from "@trpc/tanstack-react-query";

import type { AppRouter } from "../../../backend/src/trpc";
import { auth } from "./firebase";

export const { TRPCProvider, useTRPC, useTRPCClient } =
  createTRPCContext<AppRouter>();

const headers = async () => {
  const token = await auth.currentUser?.getIdToken();
  return {
    authorization: token ? `Bearer ${token}` : "",
  };
};

export function createAppTRPCClient(url: string) {
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => !!op.context.skipBatch,
        true: httpLink({ url, headers }),
        false: httpBatchLink({ url, headers }),
      }),
    ],
  });
}

export type RouterInput = inferRouterInputs<AppRouter>;
export type RouterOutput = inferRouterOutputs<AppRouter>;
