import { createFileRoute } from "@tanstack/react-router";
import { signInWithCustomToken } from "firebase/auth";
import { TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import * as z from "zod";

import Loader from "@/components/ui/loader";
import { useAuthContext } from "@/hooks/useUser";
import { auth } from "@/lib/firebase";

export const Route = createFileRoute("/custom-token-auth")({
  component: RouteComponent,
  validateSearch: z.object({
    token: z.string(),
  }),
});

function RouteComponent() {
  const navigate = Route.useNavigate();
  const { token } = Route.useSearch();
  const authContext = useAuthContext();
  const [authStarted, setAuthStarted] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    switch (authContext.status) {
      case "authenticated":
        if (!authStarted) {
          auth.signOut();
        }
        break;
      case "unauthenticated":
        setAuthStarted(true);
        signInWithCustomToken(auth, token)
          .then(() => navigate({ to: "/" }))
          .catch((error) => {
            setAuthError(error.message);
          });
        break;
      case "loading":
        // wait for auth to be loaded
        break;
    }
  }, [authContext.status, token, authStarted, navigate]);

  useEffect(() => {
    setAuthStarted(false);
  }, [token]);

  return (
    <div className="flex h-[60vh] w-full flex-col items-center justify-center">
      {authError ? (
        <>
          <TriangleAlertIcon className="text-destructive" />
          <p className="text-destructive mt-4 text-sm">Error authenticating</p>
        </>
      ) : (
        <>
          <Loader />
          <p className="text-muted-foreground mt-4 text-sm">
            Authenticating...
          </p>
        </>
      )}
    </div>
  );
}
