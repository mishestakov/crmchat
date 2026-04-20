import {
  Dispatch,
  Provider,
  SetStateAction,
  createContext,
  useContext,
} from "react";

import { View, ViewOptions } from "@repo/core/types";

import { EnrichedContact } from "@/lib/store/selectors";

export interface ViewContext {
  view: View;
  onViewOptionsChange: (view: ViewOptions) => void;
  onViewSelect: (id: string) => void;
  isLoading: boolean;
  items: EnrichedContact[];
  hasActiveFilters: boolean;
  useNewUnread: boolean;

  isSelectionMode: boolean;
  setIsSelectionMode: Dispatch<SetStateAction<boolean>>;
  selectedContacts: Set<string>;
  setSelectedContacts: Dispatch<SetStateAction<Set<string>>>;
}

const ViewContext = createContext<ViewContext | null>(null);
export const ViewContextProvider: Provider<ViewContext> = ViewContext.Provider;

// eslint-disable-next-line react-refresh/only-export-components
export function useViewContext() {
  const context = useContext(ViewContext);
  if (!context) {
    throw new Error("useViewStore must be used within a ViewContextProvider");
  }
  return context;
}
