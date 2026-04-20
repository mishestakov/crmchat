import { Provider, createContext, useContext } from "react";

export type BulkEditStep = "form" | "preview" | "progress";

type BulkEditContextType = {
  workspaceId: string;
  contactIds: Set<string>;

  updateData: Record<string, any>;
  setUpdateData: (data: Record<string, any>) => void;

  setCanCloseDialog: (canClose: boolean) => void;
  setIsCompleted: (isCompleted: boolean) => void;

  step: BulkEditStep;
  setStep: (step: BulkEditStep) => void;

  enqueueBulkUpdate: () => Promise<void>;
  isEnqueueing: boolean;
  operationId?: string;
};

const BulkEditContext = createContext<BulkEditContextType | null>(null);
export const BulkEditContextProvider: Provider<BulkEditContextType> =
  BulkEditContext.Provider;

// eslint-disable-next-line react-refresh/only-export-components
export function useBulkEditContext() {
  const context = useContext(BulkEditContext);
  if (!context) {
    throw new Error(
      "useBulkEditContext must be used within a BulkEditContextProvider"
    );
  }
  return context;
}
