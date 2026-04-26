import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../../../lib/api";
import { BackButton } from "../../../../../../components/back-button";
import {
  TelegramAuthFlow,
  type TgAuthApi,
} from "../../../../../../components/telegram-auth-flow";
import { OUTREACH_QK } from "../../../../../../lib/query-keys";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/accounts/new",
)({
  component: NewOutreachAccountPage,
});

function NewOutreachAccountPage() {
  const { wsId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const tgApi: TgAuthApi = {
    qrStreamUrl: `/v1/workspaces/${wsId}/outreach/accounts/auth/qr-stream`,
    sendCode: async (phoneNumber) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/outreach/accounts/auth/send-code",
        { params: { path: { wsId } }, body: { phoneNumber } },
      );
      if (error) throw error;
      return data;
    },
    signIn: async (args) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/outreach/accounts/auth/sign-in",
        { params: { path: { wsId } }, body: args },
      );
      if (error) throw error;
      return data;
    },
    signInPassword: async (password) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/outreach/accounts/auth/sign-in-password",
        { params: { path: { wsId } }, body: { password } },
      );
      if (error) throw error;
      return data;
    },
  };

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <TelegramAuthFlow
        api={tgApi}
        onComplete={() => {
          qc.invalidateQueries({ queryKey: OUTREACH_QK.accounts(wsId) });
          navigate({ to: "/w/$wsId/outreach/accounts", params: { wsId } });
        }}
      />
    </div>
  );
}
