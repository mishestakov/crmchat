import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { MiniAppPage } from "@/components/mini-app-page";
import { WalletBalance } from "@/features/wallet/wallet-balance";
import { WalletTopUp } from "@/features/wallet/wallet-top-up";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/wallet/top-up"
)({
  component: RouteComponent,
  validateSearch: z.object({
    returnTo: z.string().optional(),
  }),
});

function RouteComponent() {
  const { returnTo } = Route.useSearch();
  return (
    <MiniAppPage className="flex flex-col gap-4">
      <WalletBalance showTopUpButton={false} />
      <WalletTopUp returnTo={returnTo} />
    </MiniAppPage>
  );
}
