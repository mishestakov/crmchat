import * as Sentry from "@sentry/react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { usePostHog } from "posthog-js/react";
import {
  PropsWithChildren,
  createContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { UserWithId } from "@repo/core/types";

import { updateUser } from "@/lib/db/users";
import { auth, firestore, measureSnapshot } from "@/lib/firebase";
import { useWorkspacesStore } from "@/lib/store/workspaces";

type Claims = {
  _imp?: true;
  [key: string]: any;
};

type AuthState =
  | { status: "loading" | "unauthenticated"; user: null; claims?: Claims }
  | { status: "authenticated"; user: UserWithId; claims?: Claims };

const initialState: AuthState = {
  status: "loading",
  user: null,
};

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthState>(initialState);

export function AuthProvider({ children }: PropsWithChildren) {
  const posthog = usePostHog();
  const { i18n } = useTranslation();
  const resetWorkspacesStore = useWorkspacesStore((s) => s.reset);

  const [authState, setAuthState] = useState<AuthState>(initialState);

  useEffect(() => {
    let unsubscribeUser: (() => void) | undefined;
    const unsubscribeAuth = measureSnapshot(
      "Loading auth state",
      (authSpan) =>
        onAuthStateChanged(auth, (firebaseUser) => {
          console.info(
            `Auth state changed. Current user: ${firebaseUser?.uid ?? "none"}`
          );
          if (firebaseUser) {
            const userRef = doc(firestore, "users", firebaseUser.uid);
            unsubscribeUser = measureSnapshot("Fetching user", (userSpan) =>
              onSnapshot(
                userRef,
                (snapshot) => {
                  Sentry.setUser({ id: firebaseUser.uid });

                  const data = snapshot.data({ serverTimestamps: "estimate" });
                  if (!data || Object.keys(data).length === 0) {
                    console.warn(
                      "User snapshot returned an empty object",
                      data,
                      {
                        userId: firebaseUser.uid,
                        ref: userRef.path,
                        refFromDoc: snapshot.ref.path,
                        fromCache: snapshot.metadata.fromCache,
                      }
                    );
                    return;
                  }
                  const user = { ...data, id: snapshot.id } as UserWithId;
                  setAuthState((prev) => ({
                    status: "authenticated",
                    user,
                    claims: prev.claims,
                  }));

                  userSpan.end();
                },
                (err) => {
                  console.error("Error subscribing to user", err);
                  setAuthState({ status: "unauthenticated", user: null });
                  Sentry.setUser(null);

                  userSpan.end();
                }
              )
            );
            auth.currentUser?.getIdTokenResult().then((res) => {
              console.info("User claims", res.claims);
              setAuthState((prev) => ({
                ...prev,
                claims: res.claims,
              }));
            });
          } else {
            if (unsubscribeUser) {
              unsubscribeUser();
              unsubscribeUser = undefined;
            }
            setAuthState({ status: "unauthenticated", user: null });
            Sentry.setUser(null);
            resetWorkspacesStore();
          }

          authSpan.end();
        }),
      "firebase.auth"
    );
    return () => {
      unsubscribeUser?.();
      unsubscribeAuth();
    };
  }, [resetWorkspacesStore]);

  useEffect(() => {
    if (authState.user?.id) {
      console.info("Identifying user with PostHog.");
      posthog?.identify(authState.user.id, {
        telegram_id: authState.user.telegram?.id,
        telegram_username: authState.user.telegram?.username,
      });
    }
  }, [
    posthog,
    authState.user?.id,
    authState.user?.telegram?.id,
    authState.user?.telegram?.username,
  ]);

  useEffect(() => {
    if (!authState.user?.id) {
      return;
    }

    if (authState.user.locale && i18n.language !== authState.user.locale) {
      console.info("Updating app language to", authState.user.locale);
      i18n.changeLanguage(authState.user.locale).catch((err) => {
        console.warn("Failed to update language", err);
        Sentry.captureException(err);
      });
    }
  }, [i18n, authState.user?.id, authState.user?.locale]);

  // Prevents endless ping-pong updates between multiple devices that have different
  // time zones. Each client will try to sync its own TZ only **once** per session.
  const timezoneUpdated = useRef(false);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    if (
      !authState.user?.id ||
      timezoneUpdated.current ||
      authState.claims?._imp // user is impersonated
    ) {
      return;
    }
    if (authState.user.timezone !== timezone) {
      console.info("Updating user timezone to", timezone);
      updateUser(authState.user.id, { timezone })
        .catch((err) => {
          console.warn("Failed to update user timezone", err);
          Sentry.captureException(err);
        })
        .finally(() => {
          timezoneUpdated.current = true;
        });
    }
  }, [
    timezone,
    authState.user?.id,
    authState.claims?._imp,
    authState.user?.timezone,
  ]);

  return (
    <AuthContext.Provider value={authState}>{children}</AuthContext.Provider>
  );
}
