import { Navigate, createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { MiniAppPage } from "@/components/mini-app-page";
import { OutreachTabNavigation } from "@/components/outreach-tab-navigation";
import { NewCrmList } from "@/features/outreach/sequences/new-crm-list";
import { useCreateSequenceForList } from "@/features/outreach/sequences/use-create-new-sequence";
import { useCanUseSequences } from "@/hooks/subscription";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/outreach/sequences/new/crm"
)({
  validateSearch: z.object({
    // eslint-disable-next-line unicorn/prefer-top-level-await
    contactType: z.enum(["contact", "group"]).catch("contact"),
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const contactType = Route.useSearch({
    select: (s) => s.contactType,
  });
  const createSequenceForList = useCreateSequenceForList();
  const canCreateOutreachSequence = useCanUseSequences();
  if (!canCreateOutreachSequence) {
    return (
      <Navigate
        from={Route.fullPath}
        to="../../../../settings/subscription"
        search={{ minPlan: "team" }}
        replace
      />
    );
  }

  return (
    <MiniAppPage>
      <div className="flex flex-col gap-2">
        <OutreachTabNavigation />

        <NewCrmList
          contactType={contactType}
          onNewListCreated={(list) => {
            createSequenceForList(list);
          }}
        />
      </div>
    </MiniAppPage>
  );
}
