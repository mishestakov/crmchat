import { create } from "zustand";

export interface SelectedLead {
  type: "user" | "group" | "other";
  peerId: string;
  username?: string;
  avatar?: string;
  fullName: string;
  description?: string;
}

interface SelectedLeadState {
  selectedLead?: SelectedLead;
  setSelectedLead: (lead?: SelectedLead) => void;
  clearSelectedLead: () => void;
}

export const useSelectedLeadStore = create<SelectedLeadState>((set) => ({
  selectedLead: undefined,
  setSelectedLead: (lead?: SelectedLead) => set({ selectedLead: lead }),
  clearSelectedLead: () => set({ selectedLead: undefined }),
}));
