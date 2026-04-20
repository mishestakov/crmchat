import { Provider, createContext, useContext } from "react";

import { OutreachListWithId } from "@repo/core/types";

import { TextVariable } from "./text-variables-plugin";

type TextVariablesContextType = {
  list: OutreachListWithId;
  variables: TextVariable[];
  notDefinedVariables?: Map<string, { contacts: string[] }>;
  notDefinedVariablesPending?: boolean;
};

const TextVariablesContext = createContext<
  TextVariablesContextType | undefined
>(undefined);

export const TextVariablesProvider: Provider<TextVariablesContextType> =
  TextVariablesContext.Provider;

// eslint-disable-next-line react-refresh/only-export-components
export function useTextVariablesContext() {
  const context = useContext(TextVariablesContext);
  if (!context) {
    throw new Error(
      "useTextVariablesContext must be used within a TextVariablesProvider"
    );
  }
  return context;
}
