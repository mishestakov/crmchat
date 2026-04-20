import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as z from "zod";

import { ViewOptionsSchema } from "@repo/core/types";

import { HelpButton } from "@/components/help-button";
import { NewContactMenuButton } from "@/components/new-contact-menu-button";
import { useViewOptions } from "@/features/contacts/use-view-options";
import { EmptyView } from "@/features/contacts/views/empty-view";
import { ListView } from "@/features/contacts/views/list-view";
import { PipelineView } from "@/features/contacts/views/pipeline-view";
import { ViewContextProvider } from "@/features/contacts/views/view-context";
import { useUser } from "@/hooks/useUser";
import { useView } from "@/hooks/useViews";
import { useCurrentWorkspace, useWorkspaceStore } from "@/lib/store";
import { selectEnrichedContacts } from "@/lib/store/selectors";

const SearchParamsSchema = z.object({
  view: z.string().optional(),
  viewOptions: ViewOptionsSchema.partial().optional(),
  stage: z.string().optional(),
  newPipeline: z.string().optional(),
});

export const Route = createFileRoute("/_protected/w/$workspaceId/contacts/")({
  component: Contacts,
  validateSearch: SearchParamsSchema,
});

function Contacts() {
  const [view, onViewOptionsChange] = useViewOptions();

  const useNewUnread = useCurrentWorkspace(
    (w) => w.features?.includes("new-unread") ?? false
  );

  const isLoading = useWorkspaceStore((state) => state.contactsLoading);
  const items = useWorkspaceStore((state) =>
    selectEnrichedContacts(state, { ...view, useNewUnread })
  );

  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState(new Set<string>());

  const hasActiveFilters = Object.keys(view.filters).length > 0 || !!view.q;

  const user = useUser();
  const navigate = Route.useNavigate();
  useEffect(() => {
    if (!user?.onboarding?.firstContact) {
      navigate({
        from: Route.fullPath,
        to: "../onboarding",
        replace: true,
      });
    }
  }, [user?.onboarding?.firstContact, navigate]);

  const defaultView = useView("contacts", undefined);
  const onViewSelect = (id: string) => {
    navigate({
      search: (prev) => ({
        ...prev,
        view: defaultView.id === id ? undefined : id,
        viewOptions: undefined,
      }),
      replace: true,
      viewTransition: false,
    });
  };

  const renderView = () => {
    const isEmpty = !isLoading && !hasActiveFilters && items.length === 0;
    if (isEmpty) {
      return <EmptyView />;
    }

    switch (view.type) {
      case "list":
        return <ListView />;
      case "pipeline":
        return <PipelineView />;
    }
  };

  return (
    <>
      <ViewContextProvider
        value={{
          view,
          onViewOptionsChange,
          onViewSelect,
          isLoading,
          items,
          hasActiveFilters,
          useNewUnread,

          isSelectionMode,
          setIsSelectionMode,
          selectedContacts,
          setSelectedContacts,
        }}
      >
        {renderView()}
      </ViewContextProvider>
      <HelpButton offsetRem={5} />
      <NewContactMenuButton />
    </>
  );
}
