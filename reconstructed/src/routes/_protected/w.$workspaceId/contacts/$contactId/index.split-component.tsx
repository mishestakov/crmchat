import { Slot, Slottable } from "@radix-ui/react-slot";
import { useMutation } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { formatRelative } from "date-fns";
import { t } from "i18next";
import {
  AtSign,
  Bell,
  Calendar,
  EllipsisVertical,
  MessageCircle,
  NotebookPen,
  Pencil,
  Phone,
  Repeat2,
  Trash2,
  Users,
} from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { usePostHog } from "posthog-js/react";
import {
  Fragment,
  PropsWithChildren,
  Suspense,
  forwardRef,
  lazy,
  memo,
  useCallback,
  useState,
} from "react";
import { Trans, useTranslation } from "react-i18next";
import * as z from "zod";

import { ActivityWithId, ContactWithId } from "@repo/core/types";

import telegramLogo from "@/assets/telegram-logo.svg";
import { EditActivityForm, NewActivityForm } from "@/components/activity-form";
import { Chat } from "@/components/chat";
import { WithClickableLinks } from "@/components/clickable-links";
import { SocialMediaIcon } from "@/components/contacts/social-media";
import { ResponsivePage } from "@/components/mini-app-page";
import { PropertyRenderer } from "@/components/property-renderer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { DestructiveButton } from "@/components/ui/destructive-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import Loader from "@/components/ui/loader";
import {
  Section,
  SectionItem,
  SectionItemTitle,
  SectionItems,
} from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { UnreadBadge } from "@/components/ui/unread-badge";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import { useCanUseChat } from "@/hooks/subscription";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useNavigateBack } from "@/hooks/useNavigateBack";
import { useProperties } from "@/hooks/useProperties";
import { getUnreadCount, hasUnreadMessages } from "@/lib/contact";
import { deleteActivtiy, updateTaskCompletionStatus } from "@/lib/db/activites";
import { useCurrentWorkspace, useWorkspaceStore } from "@/lib/store";
import {
  selectContactActivities,
  selectContactById,
  selectContactUnreadCount,
} from "@/lib/store/selectors";
import { useTRPC } from "@/lib/trpc";
import { cn, openExternalLink } from "@/lib/utils";

const MarkdownLazy = lazy(() =>
  import("@/components/ui/markdown/renderer").then((mod) => ({
    default: mod.default,
  }))
);

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/contacts/$contactId/"
)({
  component: Contact,
  validateSearch: z.object({
    // eslint-disable-next-line unicorn/prefer-top-level-await
    chat: z.boolean().optional().catch(false),
  }),
});

function useChatState() {
  const navigate = Route.useNavigate();
  const { chat: isChatOpen } = Route.useSearch();
  const isDesktopView = useBreakpoint("md");
  const posthog = usePostHog();
  const setIsChatOpen = useCallback(
    (newState: boolean) => {
      if (newState) {
        posthog.capture("chat_opened", { source: "contact_view" });
      }
      return navigate({
        search: (prev) => ({ ...prev, chat: newState }),
        replace: isDesktopView,
        viewTransition: false,
      });
    },
    [navigate, isDesktopView, posthog]
  );

  return [isChatOpen ?? false, setIsChatOpen] as const;
}

function Contact() {
  const { contactId: id } = Route.useParams();
  const isDesktopView = useBreakpoint("md");
  const [isChatOpen, setIsChatOpen] = useChatState();

  const contact = useWorkspaceStore((state) => selectContactById(state, id));
  const activities = useWorkspaceStore((state) =>
    selectContactActivities(state, id)
  );

  if (!contact) {
    return null;
  }

  return (
    <ResponsivePage
      className="flex justify-center gap-6"
      workspaceSelector={false}
      size={isChatOpen ? "wide" : "narrow"}
      helpButton={!isChatOpen}
    >
      {(!isChatOpen || isDesktopView) && (
        <div className="@desktop:max-w-md flex w-full flex-col gap-3">
          <ContactView
            contact={contact}
            activities={activities}
            isChatOpen={isChatOpen}
            setIsChatOpen={setIsChatOpen}
          />
        </div>
      )}
      {isChatOpen && (
        <m.div
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: "100%" }}
          className="@desktop:max-w-md sticky top-3 mx-3 flex md:mx-0 md:h-[calc(100vh-2rem)]"
        >
          <Chat contact={contact} className="w-full" />
        </m.div>
      )}
    </ResponsivePage>
  );
}

export function ContactView({
  contact,
  activities,
  isChatOpen,
  setIsChatOpen,
}: {
  contact: ContactWithId;
  activities: ActivityWithId[];

  isChatOpen?: boolean;
  setIsChatOpen?: (newState: boolean) => void;
}) {
  return (
    // key is needed to prevent keeping the old contact card in the DOM
    <Fragment key={contact.id}>
      <ContactCard contact={contact} />
      <ActionButtons
        contact={contact}
        isChatOpen={isChatOpen}
        setIsChatOpen={setIsChatOpen}
      />
      <Suspense fallback={<Skeleton className="h-32 w-full shadow" />}>
        <div className="divide-background flex flex-col divide-y shadow">
          {activities.map((activity) => (
            <MemoizedActivityItem key={activity.id} activity={activity} />
          ))}
        </div>
      </Suspense>
    </Fragment>
  );
}

function ContactCard({ contact }: { contact: ContactWithId }) {
  const { t } = useTranslation();
  const [customProperties] = useProperties("contacts");
  return (
    <div className="bg-card/70 rounded-lg shadow">
      <div className="bg-card relative flex flex-col items-center gap-3 rounded-lg px-6 py-3 shadow-sm dark:shadow-lg">
        <ContactAvatar contact={contact} className="h-16 w-16" />
        <h2 className="sesnsitive text-center text-lg font-medium">
          {contact.type === "group" && (
            <Tip
              content={t("web.contacts.groupChatTooltip")}
              className="relative -top-px mr-1.5 inline-block"
            >
              <Users className="text-muted-foreground size-4 shrink-0" />
            </Tip>
          )}
          {contact.fullName}
        </h2>

        <p className="text-muted-foreground text-center text-sm">
          {contact.description ? (
            <span className="sensitive whitespace-pre-line">
              <WithClickableLinks>{contact.description}</WithClickableLinks>
            </span>
          ) : (
            <Link
              to="/w/$workspaceId/contacts/$contactId/edit"
              params={{
                workspaceId: contact.workspaceId,
                contactId: contact.id,
              }}
              search={{ focus: "description" }}
              className="group ml-4 inline-flex items-center space-x-1 hover:underline"
            >
              <span>{t("web.addDescription")}</span>
              <Pencil className="invisible size-3 group-hover:visible" />
            </Link>
          )}
        </p>

        <div className="flex flex-row flex-wrap items-center gap-2 text-center">
          <TelegramButton contact={contact} />
          {contact.url && (
            <Button
              asChild
              size="icon"
              variant="ghost"
              className="ph-no-capture"
            >
              <a href={contact.url} onClick={openExternalLink}>
                <SocialMediaIcon url={contact.url} className="size-5" />
              </a>
            </Button>
          )}
          {contact.email && (
            <Button
              asChild
              size="icon"
              variant="ghost"
              className="ph-no-capture"
            >
              <a href={`mailto:${contact.email}`} onClick={openExternalLink}>
                <AtSign className="text-muted-foreground size-5" />
              </a>
            </Button>
          )}
          {contact.phone && (
            <Button
              asChild
              size="icon"
              variant="ghost"
              className="ph-no-capture cursor-pointer"
              onClick={() => {
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                navigator.clipboard.writeText(`tel:${contact.phone}`);
              }}
            >
              <span>
                <Phone className="size-5" />
              </span>
            </Button>
          )}
          {contact.phone && (
            <Button
              asChild
              size="icon"
              variant="ghost"
              className="ph-no-capture"
            >
              <a
                href={`https://wa.me/${contact.phone}`}
                onClick={openExternalLink}
              >
                <SocialMediaIcon
                  url={`https://wa.me/${contact.phone}`}
                  className="size-5"
                />
              </a>
            </Button>
          )}
        </div>
        <ContactMenu contact={contact} />
      </div>
      <div className="py-3">
        <Suspense
          fallback={
            <div className="flex h-20 w-full items-center justify-center">
              <Loader />
            </div>
          }
        >
          {customProperties
            .map((property) => {
              if (property.readonly) return null;
              return (
                <PropertyRenderer
                  key={property.key}
                  object={contact}
                  property={property}
                />
              );
            })
            .filter(Boolean)}
        </Suspense>
      </div>
    </div>
  );
}

function TelegramButton({ contact }: { contact: ContactWithId }) {
  const { t } = useTranslation();
  if (contact.type === "group") {
    if (contact.telegram?.inviteLink) {
      return (
        <Button
          asChild
          variant={"link"}
          className="ph-no-capture text-accent-foreground h-6"
        >
          <a href={contact.telegram?.inviteLink}>
            <img src={telegramLogo} alt="Telegram" className="size-4" />
            <span>Telegram</span>
          </a>
        </Button>
      );
    } else {
      return (
        <Tip content={t("web.contacts.chatLinkUnvailable")}>
          <Button
            variant={"link"}
            className="ph-no-capture text-muted-foreground h-6 hover:no-underline"
          >
            <img
              src={telegramLogo}
              alt="Telegram"
              className="size-4 grayscale"
            />
            <span>Telegram</span>
          </Button>
        </Tip>
      );
    }
  } else if (contact.telegram?.username) {
    return (
      <Button
        asChild
        variant={"link"}
        className="ph-no-capture text-accent-foreground h-6"
      >
        <a
          href={`https://t.me/${contact.telegram.username.trim().replace(/^@/, "")}`}
        >
          <img src={telegramLogo} alt="Telegram" className="size-4" />
          <span>Telegram</span>
        </a>
      </Button>
    );
  }

  return null;
}

function ContactMenu({ contact }: { contact: ContactWithId }) {
  const { t } = useTranslation();
  return (
    <div className="absolute right-1 top-1 flex items-center space-x-4 p-3">
      <Button variant="ghost" size="icon" asChild>
        <Link
          to="/w/$workspaceId/contacts/$contactId/edit"
          params={{
            workspaceId: contact.workspaceId,
            contactId: contact.id,
          }}
          className="text-muted-foreground/70 hover:text-foreground transition-colors"
          title={t("web.contacts.editContact")}
        >
          <Pencil className="size-4" />
        </Link>
      </Button>

      <Drawer>
        <DrawerTrigger
          className="text-muted-foreground/70 hover:text-foreground transition-colors"
          title="Open Menu"
        >
          <EllipsisVertical className="size-5" />
        </DrawerTrigger>
        <DrawerContent>
          <VisuallyHidden>
            <DrawerTitle>Lead Menu</DrawerTitle>
          </VisuallyHidden>
          <Section className="mx-3 my-8">
            <SectionItems>
              <SectionItem asChild icon={Pencil}>
                <Link
                  to="/w/$workspaceId/contacts/$contactId/edit"
                  params={{
                    workspaceId: contact.workspaceId,
                    contactId: contact.id,
                  }}
                >
                  <SectionItemTitle>
                    {t("web.contacts.editContact")}
                  </SectionItemTitle>
                </Link>
              </SectionItem>
              <ContactDeleteDialog contact={contact} />
            </SectionItems>
          </Section>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function ContactDeleteDialog({ contact }: { contact: ContactWithId }) {
  const { t } = useTranslation();
  const navigateBack = useNavigateBack();
  const trpc = useTRPC();
  const { mutateAsync: deleteContacts, isPending } = useMutation(
    trpc.contact.deleteContacts.mutationOptions()
  );

  return (
    <Drawer dismissible={!isPending}>
      <DrawerTrigger asChild>
        <SectionItem className="text-destructive" icon={Trash2}>
          <SectionItemTitle>{t("web.delete")}</SectionItemTitle>
        </SectionItem>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("web.deleteConfirmTitle")}</DrawerTitle>
          <DrawerDescription>
            <Trans
              i18nKey="web.deleteContactConfirmation"
              values={{
                name: contact.fullName,
              }}
              components={[<strong className="sensitive" />]}
              parent="p"
              className="mt-2"
            />
            <p className="text-destructive mt-2">
              <strong>{t("web.deleteWarning")}</strong>
            </p>
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <DestructiveButton
            disabled={isPending}
            onClick={async () => {
              await deleteContacts({
                workspaceId: contact.workspaceId,
                contactIds: [contact.id],
              });

              navigateBack({
                fallback: {
                  to: "/w/$workspaceId",
                  params: { workspaceId: contact.workspaceId },
                  replace: true,
                },
              });
            }}
          >
            {t("web.delete")}
          </DestructiveButton>
          <DrawerClose asChild>
            <Button variant="outline" disabled={isPending} className="w-full">
              {t("web.cancel")}
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

const ActivityItem = forwardRef<HTMLDivElement, { activity: ActivityWithId }>(
  function ActivityItem({ activity }, ref) {
    return (
      <div
        key={activity.id}
        ref={ref}
        className="bg-card group p-3 first:rounded-t-lg last:rounded-b-lg"
      >
        {activity.type === "note" && (
          <div className="sensitive prose prose-sm dark:prose-invert">
            <MarkdownLazy>{activity.note.content}</MarkdownLazy>
          </div>
        )}
        {activity.type === "task" && (
          <div className="flex flex-col gap-2">
            <div className="bg-accent flex items-center gap-2 rounded-lg px-3 py-1">
              <div className="grow">
                <h3>
                  {activity.task.recurrence?.rule && (
                    <Repeat2 className="text-muted-foreground mb-0.5 mr-1.5 inline-block size-3 align-middle" />
                  )}
                  <span className="sensitive">{activity.task.summary}</span>
                </h3>

                <AnimatePresence initial={false} mode="popLayout">
                  <m.div
                    className="text-muted-foreground text-sm"
                    key={`${activity.id}-${activity.task.completedAt ? "completed" : "due"}`}
                    initial={{ y: -10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 10, opacity: 0 }}
                  >
                    {activity.task.completedAt
                      ? `completed ${formatRelative(
                          activity.task.completedAt.toDate(),
                          new Date()
                        )}`
                      : `due ${formatRelative(
                          activity.task.dueDate.toDate(),
                          new Date()
                        )}`}
                  </m.div>
                </AnimatePresence>
              </div>
              <Checkbox
                className="h-6 w-6"
                checked={!!activity.task.completedAt}
                onCheckedChange={(newState) =>
                  updateTaskCompletionStatus(
                    activity.workspaceId,
                    activity.id,
                    !!newState
                  )
                }
              />
            </div>
            {activity.task.content && (
              <div className="sensitive prose prose-sm dark:prose-invert">
                <MarkdownLazy>{activity.task.content}</MarkdownLazy>
              </div>
            )}
          </div>
        )}
        <div className="text-muted-foreground mt-1.5 flex flex-row justify-end space-x-1 text-xs">
          <span>{formatRelative(activity.createdAt.toDate(), new Date())}</span>
          <ActivityMenu activity={activity} />
        </div>
      </div>
    );
  }
);

const MemoizedActivityItem = memo(ActivityItem);

function EditActivitySectionItem({ activity }: { activity: ActivityWithId }) {
  const { t } = useTranslation();
  const isDesktop = useBreakpoint("md");
  const [isOpen, setIsOpen] = useState(false);

  if (isDesktop) {
    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <SectionItem icon={Pencil}>
            <SectionItemTitle>
              {t(`web.activities.edit_${activity.type}`)}
            </SectionItemTitle>
          </SectionItem>
        </DialogTrigger>
        <DialogContent
          className="!max-w-lg"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <VisuallyHidden>
              <DialogTitle>
                {t(`web.activities.edit_${activity.type}`)}
              </DialogTitle>
            </VisuallyHidden>
          </DialogHeader>
          <EditActivityForm
            activity={activity}
            onSuccess={() => {
              setIsOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <SectionItem asChild icon={Pencil}>
      <Link
        to="/w/$workspaceId/contacts/$contactId/activities/$activityId/edit"
        params={{
          workspaceId: activity.workspaceId,
          contactId: activity.contactId,
          activityId: activity.id,
        }}
      >
        <SectionItemTitle>
          {t(`web.activities.edit_${activity.type}`)}
        </SectionItemTitle>
      </Link>
    </SectionItem>
  );
}

function ActivityMenu({ activity }: { activity: ActivityWithId }) {
  const { t } = useTranslation();
  return (
    <Drawer>
      <DrawerTrigger className="text-muted-foreground/70 hover:text-foreground transition-colors">
        <EllipsisVertical className="size-4" />
      </DrawerTrigger>
      <DrawerContent>
        <VisuallyHidden>
          <DrawerTitle>Menu</DrawerTitle>
        </VisuallyHidden>
        <div className="mx-3 my-4 space-y-6">
          <Section>
            <SectionItems>
              <EditActivitySectionItem activity={activity} />
              {activity.type === "task" &&
                activity.task.googleCalendarEvent?.url && (
                  <SectionItem asChild icon={Calendar}>
                    <a
                      href={activity.task.googleCalendarEvent.url}
                      target="_blank"
                    >
                      <SectionItemTitle>
                        {t("web.activities.openInGoogleCalendar")}
                      </SectionItemTitle>
                    </a>
                  </SectionItem>
                )}
              <ActivityDeleteDialog activity={activity} />
            </SectionItems>
          </Section>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function ActivityDeleteDialog({ activity }: { activity: ActivityWithId }) {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <SectionItem className="text-destructive" icon={Trash2}>
          <SectionItemTitle>
            {t(`web.activities.delete_${activity.type}`)}
          </SectionItemTitle>
        </SectionItem>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("web.deleteConfirmTitle")}</DrawerTitle>
          <DrawerDescription>
            {t(`web.activities.deleteConfirmation_${activity.type}`)}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <DestructiveButton
            enableTimeout={300}
            onClick={async () => {
              await deleteActivtiy(activity.workspaceId, activity.id);
            }}
          >
            {t(`web.activities.delete_${activity.type}`)}
          </DestructiveButton>
          <DrawerClose asChild>
            <Button variant="outline" className="w-full">
              {t("web.cancel")}
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function ActionButton({
  className,
  icon: Icon,
  iconClassName,
  children,
}: PropsWithChildren<{
  asChild: true;
  className?: string;
  icon: React.ExoticComponent<{ className?: string }>;
  iconClassName?: string;
}>) {
  return (
    <Slot
      className={cn(
        "bg-card hover:bg-card/60 text-card-foreground group relative flex flex-col items-center gap-2 rounded-lg p-3 text-center text-xs shadow transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      <Icon
        className={cn(
          "text-primary size-5 transition-transform group-hover:-rotate-2 group-hover:scale-110",
          iconClassName
        )}
      />
      <Slottable>{children}</Slottable>
    </Slot>
  );
}

function NewActivityActionButton({
  type,
  contact,
  children,
  icon,
}: PropsWithChildren<{
  type: ActivityWithId["type"];
  contact: ContactWithId;
  icon: React.ExoticComponent<{ className?: string }>;
}>) {
  const isDesktop = useBreakpoint("md");
  const [isOpen, setIsOpen] = useState(false);
  if (isDesktop) {
    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <ActionButton asChild icon={icon}>
            <button onClick={() => setIsOpen(true)}>{children}</button>
          </ActionButton>
        </DialogTrigger>
        <DialogContent
          className="!max-w-lg"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <VisuallyHidden>
              <DialogTitle>{children}</DialogTitle>
            </VisuallyHidden>
          </DialogHeader>
          <NewActivityForm
            type={type}
            contact={contact}
            onSuccess={() => {
              setIsOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <ActionButton asChild icon={icon}>
      <Link
        to="/w/$workspaceId/contacts/$contactId/activities/new"
        params={{
          workspaceId: contact.workspaceId,
          contactId: contact.id,
        }}
        search={{ type }}
      >
        {children}
      </Link>
    </ActionButton>
  );
}

function ActionButtons({
  contact,
  isChatOpen,
  setIsChatOpen,
}: {
  contact: ContactWithId;

  isChatOpen?: boolean;
  setIsChatOpen?: (newState: boolean) => void;
}) {
  const hasTelegram = !!contact.telegram?.id || !!contact.telegram?.username;
  const navigate = Route.useNavigate();
  const canUseChat = useCanUseChat();

  const useNewUnread = useCurrentWorkspace(
    (w) => w.features?.includes("new-unread") ?? false
  );
  const unreadCount = useWorkspaceStore((state) =>
    selectContactUnreadCount(state, contact.id)
  );
  const existingAccountIds = useWorkspaceStore(
    (state) => new Set(Object.keys(state.telegramAccountsById))
  );

  return (
    <div className="grid auto-cols-fr grid-flow-col gap-3">
      <NewActivityActionButton type="note" contact={contact} icon={NotebookPen}>
        <Trans i18nKey="web.addNote" />
      </NewActivityActionButton>
      <NewActivityActionButton type="task" contact={contact} icon={Bell}>
        <Trans i18nKey="web.addReminder" />
      </NewActivityActionButton>
      {isChatOpen !== undefined && (
        <ActionButton
          asChild
          icon={MessageCircle}
          iconClassName={cn("relative", isChatOpen && "text-muted-foreground")}
        >
          <button
            type="button"
            onClick={() => {
              if (canUseChat) {
                if (hasTelegram) {
                  setIsChatOpen?.(!isChatOpen);
                }
              } else {
                navigate({
                  from: Route.fullPath,
                  to: "../../settings/subscription",
                  search: { minPlan: "pro" },
                });
              }
            }}
            disabled={!hasTelegram}
          >
            <div className="flex flex-row items-center">
              <Trans i18nKey={isChatOpen ? "web.closeChat" : "web.openChat"} />
              {useNewUnread
                ? unreadCount > 0 && (
                    <UnreadBadge
                      className="absolute right-1 top-1"
                      count={unreadCount}
                    />
                  )
                : hasUnreadMessages(contact, existingAccountIds) && (
                    <UnreadBadge
                      className="absolute right-1 top-1"
                      count={getUnreadCount(contact, existingAccountIds)}
                    />
                  )}
            </div>
          </button>
        </ActionButton>
      )}
    </div>
  );
}
