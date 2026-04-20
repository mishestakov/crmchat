import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { TelegramRequireAuth } from "@/components/telegram-auth";
import { useUser } from "@/hooks/useUser";
import { findContactById } from "@/lib/db/contacts";
import { webApp } from "@/lib/telegram";

export const Route = createFileRoute("/_protected")({
  component: RouteComponent,
});

function useStartParamHandler() {
  const user = useUser();
  const navigate = useNavigate();

  const handlingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!user?.workspaces) return;

    const startParam = webApp?.initDataUnsafe.start_param;
    const match = startParam?.match(/^c_(?<contactId>.+)$/);
    if (match?.groups?.contactId) {
      (async function handle() {
        if (handlingRef.current) return;

        handlingRef.current = true;
        const contact = await findContactById(
          user.workspaces,
          match!.groups!.contactId!
        );
        if (contact) {
          navigate({
            to: "/w/$workspaceId/contacts/$contactId",
            params: {
              workspaceId: contact.workspaceId,
              contactId: contact.id,
            },
          });
        }
      })();
    }
  }, [navigate, user?.workspaces]);
}

function RouteComponent() {
  useStartParamHandler();

  return (
    <TelegramRequireAuth>
      <Outlet />
    </TelegramRequireAuth>
  );
}
