import { useMutation } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, createFileRoute } from "@tanstack/react-router";
import { TRPCClientError } from "@trpc/client";
import { Clock, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { PublicWorkspaceMember, WorkspaceRoleSchema } from "@repo/core/types";

import telegramLogo from "@/assets/telegram-logo.svg";
import { LoadingScreen } from "@/components/LoadingScreen";
import { MiniAppPage } from "@/components/mini-app-page";
import { SimpleForm } from "@/components/simple-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { MemberAvatar } from "@/components/ui/member-avatar";
import {
  Section,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "@/components/ui/section";
import { useNavigateBack } from "@/hooks/useNavigateBack";
import { useUser } from "@/hooks/useUser";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { orpc } from "@/lib/orpc";
import { useCurrentWorkspace } from "@/lib/store";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/workspace/user/$userId"
)({
  component: WorkspaceMember,
});

function WorkspaceMember() {
  const user = useUser();
  const { t } = useTranslation();
  const { workspaceId, userId } = Route.useParams();
  const { members, workspaceRole, isPending } = useWorkspaceMembers();
  const member = members?.find((member) => member.userId === userId);

  if (isPending) {
    return <LoadingScreen />;
  }

  if (!member) {
    return (
      <Navigate
        to="/w/$workspaceId/settings/workspace"
        params={{ workspaceId }}
      />
    );
  }
  const isMe = user?.id === member?.userId;
  return (
    <MiniAppPage className="space-y-6" workspaceSelector={false}>
      <Section>
        <SectionHeader>{t("web.workspace.user.memberHeader")}</SectionHeader>
        <SectionItems>
          <SectionItem asChild icon={null} className="hover:bg-card">
            <div>
              <MemberAvatar member={member} className="size-12" />
              <div className="mr-auto">
                <h1 className="flex items-center space-x-2 text-xl font-semibold">
                  <span>{member.user.name}</span>
                  {isMe && <Badge>{t("web.you")}</Badge>}
                </h1>
                <p className="text-muted-foreground text-sm">
                  {t(`web.role.${member.role}`)}
                </p>
              </div>
            </div>
          </SectionItem>
          {!isMe && member.user.telegramUsername && (
            <SectionItem asChild>
              <a href={`https://t.me/${member.user.telegramUsername}`}>
                <img src={telegramLogo} alt="Telegram" className="size-4" />
                <SectionItemTitle className="mr-auto">
                  {t("web.workspace.user.sendMessage")}
                </SectionItemTitle>
              </a>
            </SectionItem>
          )}
          <SectionItem icon={null}>
            <Clock className="text-muted-foreground size-4" />
            <SectionItemTitle>{t("web.timezone")}</SectionItemTitle>
            <SectionItemValue>{member.user.timezone ?? "UTC"}</SectionItemValue>
          </SectionItem>
        </SectionItems>
      </Section>
      <RoleForm member={member} isMe={isMe} />
      {(isMe || workspaceRole === "admin") && (
        <RemoveFromWorkspace member={member} isMe={isMe} />
      )}
    </MiniAppPage>
  );
}

function RoleForm({
  member,
  isMe,
}: {
  member: PublicWorkspaceMember;
  isMe: boolean;
}) {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const activeWorkspaceId = useCurrentWorkspace((state) => state.id);
  const { mutateAsync: changeRole } = useMutation(
    trpc.workspace.changeWorkspaceMemberRole.mutationOptions()
  );
  const queryClient = useQueryClient();
  const { workspaceRole } = useWorkspaceMembers();
  return (
    <SimpleForm
      label={t("web.workspace.invite.roleLabel")}
      description={
        isMe ? t("web.workspace.user.cannotChangeOwnRole") : undefined
      }
      value={member.role}
      valueSchema={WorkspaceRoleSchema}
      onSubmit={async (role) => {
        try {
          await changeRole({
            workspaceId: activeWorkspaceId,
            userId: member.userId,
            role,
          });
          queryClient.invalidateQueries({
            queryKey: orpc.workspaces.getMembers.key(),
          });
        } catch (error) {
          toast.error(
            error instanceof TRPCClientError
              ? error.message
              : t("web.common.error.somethingWentWrong")
          );
        }
      }}
      children={(field) => (
        <field.ComboboxInput
          options={WorkspaceRoleSchema.options.map((role) => ({
            label: t(`web.role.${role}`),
            value: role,
          }))}
          disabled={isMe || workspaceRole !== "admin"}
          className="min-h-10 border-none font-medium"
        />
      )}
    />
  );
}

function RemoveFromWorkspace({
  member,
  isMe,
}: {
  member: PublicWorkspaceMember;
  isMe: boolean;
}) {
  const trpc = useTRPC();
  const navigateBack = useNavigateBack();
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();
  const queryClient = useQueryClient();
  const activeWorkspaceId = useCurrentWorkspace((state) => state.id);
  const { mutateAsync: removeMember, isPending } = useMutation(
    trpc.workspace.removeWorkspaceMember.mutationOptions()
  );

  const remove = async () => {
    try {
      await removeMember({
        userId: member.userId,
        workspaceId: activeWorkspaceId,
      });

      navigateBack({
        fallback: {
          to: "/w/$workspaceId/settings/workspace",
          params: { workspaceId },
        },
      });

      queryClient.invalidateQueries({
        queryKey: orpc.workspaces.getMembers.key(),
      });
    } catch (error) {
      if (error instanceof TRPCClientError) {
        toast.error(error.message);
      }
    }
  };

  return (
    <Section>
      <SectionItems>
        <Drawer dismissible={!isPending}>
          <DrawerTrigger asChild>
            <SectionItem className="text-destructive" icon={Trash2}>
              <SectionItemTitle>
                {isMe
                  ? t("web.workspace.user.leaveWorkspace")
                  : t("web.workspace.user.removeFromWorkspace")}
              </SectionItemTitle>
            </SectionItem>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t("web.deleteConfirmTitle")}</DrawerTitle>
              <DrawerDescription>
                <p className="mt-2">
                  {isMe
                    ? t("web.workspace.user.youLoseAccessWarning")
                    : t("web.workspace.user.loseAccessWarning")}
                </p>
              </DrawerDescription>
            </DrawerHeader>
            <DrawerFooter>
              <DestructiveButton disabled={isPending} onClick={remove}>
                {isMe
                  ? t("web.workspace.user.leaveWorkspace")
                  : t("web.workspace.user.removeFromWorkspace")}
              </DestructiveButton>
              <DrawerClose asChild>
                <Button
                  variant="outline"
                  disabled={isPending}
                  className="w-full"
                >
                  {t("web.cancel")}
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </SectionItems>
    </Section>
  );
}
