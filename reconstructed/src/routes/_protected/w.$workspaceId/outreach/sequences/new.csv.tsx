import { Navigate, createFileRoute } from "@tanstack/react-router";

import { ResponsivePage } from "@/components/mini-app-page";
import { OutreachTabNavigation } from "@/components/outreach-tab-navigation";
import { NewCsvList } from "@/features/outreach/sequences/new-csv-list";
import { useCreateSequenceForList } from "@/features/outreach/sequences/use-create-new-sequence";
import { useCanUseSequences } from "@/hooks/subscription";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/outreach/sequences/new/csv"
)({
  component: RouteComponent,
});

function RouteComponent() {
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
    <ResponsivePage>
      <div className="flex flex-col gap-2">
        <div className="max-w-md">
          <OutreachTabNavigation />
        </div>

        <NewCsvList
          onNewListCreated={(list) => {
            createSequenceForList(list);
          }}
        />
      </div>
    </ResponsivePage>
  );
}
