import { useQuery } from "@tanstack/react-query";

import { auth } from "@/lib/firebase";

export function useIdToken() {
  const { data: idToken } = useQuery({
    queryKey: ["currentUserIdToken"],
    queryFn: async () => {
      return await auth.currentUser?.getIdToken();
    },
  });

  return idToken;
}
