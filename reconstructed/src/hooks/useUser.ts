import { useContext } from "react";

import { AuthContext } from "@/components/providers/auth-provider";

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useUser must be used within an AuthProvider");
  }
  return context;
}

export function useUser() {
  const context = useAuthContext();
  return context.user;
}
