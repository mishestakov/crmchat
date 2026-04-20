import { createORPCClient } from "@orpc/client";
import { BatchLinkPlugin } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import type { JsonifiedClient } from "@orpc/openapi-client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import type { ApiRouter } from "../../../backend/src/orpc/router";
import { getCachedApiUrlOrFallback } from "../config";
import contract from "./api-contract.generated.json";
import { auth } from "./firebase";

const link = new OpenAPILink(contract as unknown as ApiRouter, {
  url: () => getCachedApiUrlOrFallback("v1"),
  headers: async () => {
    const token = await auth.currentUser?.getIdToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  },
  plugins: [
    new BatchLinkPlugin({
      groups: [{ condition: () => true, context: {} }],
    }),
  ],
});

export const api: JsonifiedClient<ContractRouterClient<ApiRouter>> =
  createORPCClient(link);

export const orpc = createTanstackQueryUtils(api);
