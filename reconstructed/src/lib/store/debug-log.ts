import { create } from "zustand";

interface LogEntry {
  date: Date;
  message: string;
}

export interface DebugLogStore {
  namespaces: Record<string, LogEntry[]>;
  addDebugMessage: (namespace: string, message: string) => void;
  clear: (namespace: string) => void;
}

export const useDebugLogStore = create<DebugLogStore>()((set) => ({
  namespaces: {},
  addDebugMessage: (namespace: string, message: string) => {
    set((state) => {
      const entry = { date: new Date(), message };
      const logs = state.namespaces[namespace]
        ? [...state.namespaces[namespace], entry]
        : [entry];
      return {
        namespaces: {
          ...state.namespaces,
          [namespace]: logs,
        },
      };
    });
  },
  clear: (namespace: string) => {
    set((state) => ({
      namespaces: {
        ...state.namespaces,
        [namespace]: [],
      },
    }));
  },
}));
