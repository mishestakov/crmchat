import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { Plus } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import { AnimateChangeInHeight } from "@/components/animate-height";
import { MiniAppPage } from "@/components/mini-app-page";
import { SimpleForm } from "@/components/simple-form";
import { Badge } from "@/components/ui/badge";
import Loader from "@/components/ui/loader";
import { MemberAvatar } from "@/components/ui/member-avatar";
import {
  Section,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "@/components/ui/section";
import { useUser } from "@/hooks/useUser";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { updateWorkspace } from "@/lib/db/workspaces";
import { orpc } from "@/lib/orpc";
import { useCurrentWorkspace } from "@/lib/store";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/workspace/"
)({
  loader: ({ context, params }) => {
    // do not await this nor return the promise, just kick off the query to stream it to the client
    context.queryClient.fetchQuery(
      orpc.workspaces.getMembers.queryOptions({
        input: { workspaceId: params.workspaceId },
      })
    );
  },
  component: Members,
});

function Members() {
  return (
    <MiniAppPage className="flex flex-col gap-6">
      <WorkspaceNameForm />
      <MemberList />
      <AnimateChangeInHeight>
        <PendingInvites />
      </AnimateChangeInHeight>
    </MiniAppPage>
  );
}

function MemberList() {
  const user = useUser();
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((state) => state.id);
  const { members, workspaceRole, isPending } = useWorkspaceMembers();

  return (
    <Section>
      <SectionHeader>{t("web.teamMembers")}</SectionHeader>
      {isPending ? (
        <div className="m-3 text-center">
          <Loader />
        </div>
      ) : (
        <SectionItems>
          {members?.map((member) => (
            <SectionItem key={member.userId} asChild>
              <Link
                to="/w/$workspaceId/settings/workspace/user/$userId"
                params={{ workspaceId, userId: member.userId }}
              >
                <MemberAvatar member={member} className="size-5 text-[10px]" />
                <SectionItemTitle>{member.user.name}</SectionItemTitle>
                {member.userId === user?.id && (
                  <Badge shape="inline">{t("web.you")}</Badge>
                )}
                <SectionItemValue>
                  {t(`web.role.${member.role}`)}
                </SectionItemValue>
              </Link>
            </SectionItem>
          ))}
          {workspaceRole === "admin" && (
            <SectionItem
              asChild
              className="text-muted-foreground hover:text-foreground"
            >
              <Link
                to="/w/$workspaceId/settings/workspace/invite"
                params={{ workspaceId }}
              >
                <Plus className="text-muted-foreground mx-0.5 size-4" />
                <SectionItemTitle className="mr-auto">
                  {t("web.workspace.inviteTeamMember")}
                </SectionItemTitle>
              </Link>
            </SectionItem>
          )}
        </SectionItems>
      )}
    </Section>
  );
}

function PendingInvites() {
  const trpc = useTRPC();
  const workspaceId = useCurrentWorkspace((state) => state.id);
  const { t } = useTranslation();
  const { data: invites, isPending } = useQuery(
    trpc.workspace.getPendingInvites.queryOptions({ workspaceId })
  );

  if (isPending || !invites?.length) {
    return null;
  }

  return (
    <Section>
      <SectionHeader>{t("web.workspace.pendingInvitesTitle")}</SectionHeader>

      <SectionItems>
        {invites?.map((invite) => (
          <SectionItem key={invite.id} asChild icon={null}>
            <div>
              <SectionItemTitle>@{invite.telegramUsername}</SectionItemTitle>
              <SectionItemValue>
                {t("web.workspace.inviteExpiresIn", {
                  distance: formatDistanceToNowStrict(invite.expiresAt),
                })}
              </SectionItemValue>
            </div>
          </SectionItem>
        ))}
      </SectionItems>
    </Section>
  );
}

function WorkspaceNameForm() {
  const { t } = useTranslation();
  const posthog = usePostHog();
  const workspace = useCurrentWorkspace((s) => s);
  return (
    <SimpleForm
      label={t("web.workspace.nameLabel")}
      value={workspace?.name ?? ""}
      valueSchema={z.string().min(1, "web.workspace.nameRequiredError").trim()}
      onSubmit={async (name) => {
        await updateWorkspace(workspace.id, { name });
        posthog.capture("$groupidentify", {
          $group_type: "workspace",
          $group_key: workspace.id,
          $group_set: {
            name,
          },
        });
        toast.success(t("web.workspace.nameUpdated"));
      }}
      children={(field) => (
        <field.TextInput
          className="min-h-11 border-none font-medium"
          placeholder={t("web.workspace.namePlaceholder")}
        />
      )}
    />
  );
}
