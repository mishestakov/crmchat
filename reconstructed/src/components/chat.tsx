import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  MessageCircle,
  MessageCirclePlus,
  Pencil,
  Plus,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ContactAccountStatus,
  ContactWithId,
  TelegramAccountWithId,
} from "@repo/core/types";
import { normalizeTelegramUsername } from "@repo/core/utils";

import { AccountStatusIndicator } from "./account-status-indicator";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "./ui/sidebar";
import { Tip } from "./ui/tooltip";
import { UnreadBadge, UnreadIndicator } from "./ui/unread-badge";
import premiumIcon from "@/assets/telegram-premium.png";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import { ChatIframe } from "@/features/outreach/chat/chat-iframe";
import { useNavigateBack } from "@/hooks/useNavigateBack";
import { getUnreadCountForAccount, hasUnreadMessages } from "@/lib/contact";
import { createContact } from "@/lib/db/contacts";
import { getDialogsForContact } from "@/lib/db/telegram";
import { auth } from "@/lib/firebase";
import {
  useActiveSubscription,
  useCurrentWorkspace,
  useWorkspaceStore,
} from "@/lib/store";
import { SelectedLead, useSelectedLeadStore } from "@/lib/store/chat";
import {
  selectContactActivities,
  selectContactByTelegramIdOrUsername,
  selectContactUnreadCount,
  selectUnreadDialogsForContact,
} from "@/lib/store/selectors";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ContactView } from "@/routes/_protected/w.$workspaceId/contacts/$contactId/index";

function useSelectedContact(contact?: ContactWithId) {
  const selectedLead = useSelectedLeadStore((s) => s.selectedLead);
  const selectedContact = useWorkspaceStore((s) =>
    selectContactByTelegramIdOrUsername(
      s,
      selectedLead?.peerId,
      selectedLead?.username
    )
  );
  return contact ?? selectedContact;
}

function useSelectedAccount(contact?: ContactWithId) {
  const useNewUnread = useCurrentWorkspace(
    (w) => w.features?.includes("new-unread") ?? false
  );
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const accounts = useWorkspaceStore((s) => s.telegramAccounts);
  const [selectedAccountId, setSelectedAccountId] = useState<string>();

  const unreadDialogs = useWorkspaceStore((s) =>
    selectUnreadDialogsForContact(s, contact?.id)
  );

  const { data: allDialogs, isLoading: isLoadingAllDialogs } = useQuery({
    queryKey: ["dialogs", workspaceId, contact?.id],
    enabled: useNewUnread && !!workspaceId && !!contact?.id,
    queryFn: async () => {
      if (!contact) {
        return [];
      }
      return await getDialogsForContact(workspaceId, contact);
    },
  });

  useEffect(() => {
    const hasSelectedAccount =
      selectedAccountId && accounts.find((a) => a.id === selectedAccountId);
    if (hasSelectedAccount) {
      return;
    }

    if (!useNewUnread) {
      // old method, will be removed in the future
      const contactAccounts = contact?.telegram?.account ?? {};
      // preselect account with unread messages
      let accountEntry = Object.entries(contactAccounts).find(
        ([accountId, accountData]) => {
          const hasUnreadMessages = accountData.unread;
          const accountExists = accounts.find((a) => a.id === accountId);
          return hasUnreadMessages && accountExists;
        }
      );

      if (!accountEntry) {
        // if there is no account with unread messages,
        // preselect the account that had a conversation with the contact
        accountEntry = Object.entries(contactAccounts).find(([accountId]) => {
          const accountExists = accounts.find((a) => a.id === accountId);
          return accountExists;
        });
      }

      if (accountEntry) {
        const [accountId] = accountEntry;
        setSelectedAccountId(accountId);
      } else {
        setSelectedAccountId(accounts[0]?.id);
      }
      return;
    }

    // 1. first try to find unread dialogs for the contact
    if (unreadDialogs[0]) {
      setSelectedAccountId(unreadDialogs[0].accountId);
      return;
    }

    // 2. then try to find account that had a conversation with the contact
    if (isLoadingAllDialogs) {
      // wait
      return;
    }

    if (allDialogs?.[0]) {
      // if found, select it
      setSelectedAccountId(allDialogs[0].accountId);
    } else {
      // otherwise, select the first account
      setSelectedAccountId(accounts[0]?.id);
    }
  }, [
    selectedAccountId,
    accounts,
    contact?.telegram?.account,
    workspaceId,
    useNewUnread,
    unreadDialogs,
    allDialogs,
    isLoadingAllDialogs,
  ]);

  return [selectedAccountId, setSelectedAccountId] as const;
}

function useWarningModals() {
  const { t } = useTranslation();

  const workspaceId = useCurrentWorkspace((s) => s.id);
  const accountsLoading = useWorkspaceStore((s) => s.telegramAccountsLoading);
  const accounts = useWorkspaceStore((s) => s.telegramAccounts);

  const [showTelegramWarning, setShowTelegramWarning] = useState(false);
  const subscriptionPlan = useActiveSubscription((s) => s.plan);

  const navigateBack = useNavigateBack();
  const onModalOpenChange = (open: boolean) => {
    if (!open) {
      navigateBack({
        fallback: { to: "/w/$workspaceId/contacts", params: { workspaceId } },
      });
    }
  };

  if (accounts.length > 0 || accountsLoading) {
    return null;
  }

  return (
    <>
      {subscriptionPlan === "outreach" ? (
        <Dialog open onOpenChange={onModalOpenChange}>
          <DialogContent className="max-w-[90vw] rounded-lg sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle className="mb-2 text-left text-xl font-semibold">
                {t("web.chat.connectOutreachAccount")}
              </DialogTitle>
            </DialogHeader>
            <DialogDescription className="space-y-4">
              <p className="text-left">{t("web.chat.canLinkMultiple")}</p>
            </DialogDescription>
            <DialogFooter>
              <div className="flex w-full justify-center">
                <Button
                  size="lg"
                  className="w-full"
                  onClick={() => setShowTelegramWarning(true)}
                >
                  {t("web.chat.connectTelegramAccount")}
                  <ChevronDown className="size-4 -rotate-90" />
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <Dialog open onOpenChange={onModalOpenChange}>
          <DialogContent className="max-w-[90vw] rounded-lg sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle className="mb-2 max-w-[250px] text-left text-xl font-semibold">
                {t("web.chat.manageChatAndLeads")}
              </DialogTitle>
            </DialogHeader>
            <DialogDescription className="space-y-4">
              <p className="text-left">
                {t("web.chat.openTelegramFromCrmchat")}
              </p>
            </DialogDescription>
            <DialogFooter>
              <div className="flex w-full justify-center">
                <Button
                  size="lg"
                  className="w-full"
                  onClick={() => setShowTelegramWarning(true)}
                >
                  {t("web.chat.connectTelegramAccount")}
                  <ChevronDown className="size-4 -rotate-90" />
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={showTelegramWarning} onOpenChange={setShowTelegramWarning}>
        <DialogContent className="max-w-[90vw] rounded-lg sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="mb-2 text-center text-xl font-semibold">
              {t("web.chat.loggingIntoTelegram")}
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-center">
            {t("web.chat.messagesStayPrivate")}
          </DialogDescription>
          <DialogFooter>
            <div className="flex w-full justify-center">
              <Button asChild size="lg" className="w-full">
                <Link
                  to="/w/$workspaceId/outreach/telegram-accounts/new"
                  params={{ workspaceId }}
                >
                  {t("web.chat.continue")}
                </Link>
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Chat({
  className,
  contact,
}: {
  className?: string;
  contact?: ContactWithId;
}) {
  const { t } = useTranslation();
  const accounts = useWorkspaceStore((s) => s.telegramAccounts);

  const selectedLead = useSelectedLeadStore((s) => s.selectedLead);
  const selectedContact = useSelectedContact(contact);
  const [selectedAccountId, setSelectedAccountId] =
    useSelectedAccount(selectedContact);

  const selectedContactActivities = useWorkspaceStore((s) =>
    selectedContact ? selectContactActivities(s, selectedContact.id) : []
  );

  const warningModals = useWarningModals();
  if (warningModals) {
    return warningModals;
  }

  return (
    <SidebarProvider
      defaultOpen
      keyboardShortcut={false}
      persistenceKey="chat-sidebar"
      className={cn("flex grow", className)}
      style={{ "--sidebar-width": "20rem" } as React.CSSProperties}
    >
      <div className="flex grow flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <AccountSelector
            selectedId={selectedAccountId}
            contact={selectedContact}
            accounts={accounts}
            onChange={setSelectedAccountId}
          />
          {selectedContact && (
            <div className="@desktop:hidden">
              <Drawer>
                <DrawerTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex w-full items-center justify-start gap-2"
                  >
                    <Pencil className="text-muted-foreground size-4" />
                    <span className="hidden md:block">
                      {t("web.chat.editLead")}
                    </span>
                  </Button>
                </DrawerTrigger>
                <DrawerContent>
                  <div className="mx-3 mt-2 flex flex-col gap-2">
                    <ContactView
                      contact={selectedContact}
                      activities={selectedContactActivities}
                    />
                  </div>
                </DrawerContent>
              </Drawer>
            </div>
          )}
          {!contact && (
            <SidebarTrigger
              side="right"
              variant="card"
              size="sm"
              className="@desktop:flex hidden size-10 rounded-lg shadow"
            />
          )}
        </div>
        {selectedAccountId && (
          <ChatIframe
            key={selectedAccountId}
            className="min-w-0 grow"
            accountId={selectedAccountId}
            contact={contact}
          />
        )}
      </div>

      {!contact && (
        <Sidebar
          className="ml-2 shadow-none"
          side="right"
          variant="sidebar"
          collapsible="offcanvas"
        >
          <SidebarContent className="gap-2 p-2">
            {selectedContact ? (
              <ContactView
                contact={selectedContact}
                activities={selectedContactActivities}
              />
            ) : selectedLead &&
              ["user", "group"].includes(selectedLead.type) ? (
              <div className="flex h-full flex-col items-center justify-center px-4">
                <NonExistingLeadCard
                  lead={selectedLead}
                  accountId={selectedAccountId!}
                />
              </div>
            ) : (
              <div className="text-muted-foreground flex h-full flex-col items-center justify-center px-4 text-center">
                <MessageCircle className="mx-auto mb-2 size-6" />
                <p className="text-sm">{t("web.chat.selectContactToChat")}</p>
              </div>
            )}
          </SidebarContent>
          <SidebarRail />
        </Sidebar>
      )}
    </SidebarProvider>
  );
}

function AccountRow({
  account,
  contactId,
  status,
  useNewUnread,
}: {
  account: TelegramAccountWithId;
  contactId?: string;
  status?: ContactAccountStatus;
  useNewUnread: boolean;
}) {
  const unreadCount = useWorkspaceStore((state) =>
    contactId ? selectContactUnreadCount(state, contactId, account.id) : 0
  );
  const oldUnreadCount = status ? getUnreadCountForAccount(status) : 0;

  return (
    <div className="flex w-full flex-row items-center gap-2">
      <AccountStatusIndicator account={account} />
      <span className="whitespace-nowrap">{account.telegram?.fullName}</span>
      {account.telegram?.username && (
        <span className="text-muted-foreground whitespace-nowrap">
          @{account.telegram?.username}
        </span>
      )}{" "}
      {account.telegram.hasPremium && (
        <img src={premiumIcon} className="size-4 shrink-0" />
      )}
      {useNewUnread
        ? unreadCount > 0 && (
            <UnreadBadge className="ml-auto shrink-0" count={unreadCount} />
          )
        : oldUnreadCount > 0 && (
            <UnreadBadge className="ml-auto shrink-0" count={oldUnreadCount} />
          )}
    </div>
  );
}

function AccountSelector({
  selectedId,
  contact,
  accounts,
  onChange,
}: {
  selectedId: string | undefined;
  contact?: ContactWithId;
  accounts: TelegramAccountWithId[];
  onChange: (value: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const selectedAccount = accounts.find((a) => a.id === selectedId);

  const useNewUnread = useCurrentWorkspace(
    (w) => w.features?.includes("new-unread") ?? false
  );
  const hasUnread = useWorkspaceStore((state) =>
    contact ? selectContactUnreadCount(state, contact.id) > 0 : false
  );
  const existingAccountIds = new Set(accounts.map((a) => a.id));

  return (
    <div className="flex flex-col gap-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="card"
            className="group min-w-0 shrink items-center justify-between gap-1 rounded-lg font-medium shadow"
          >
            {selectedAccount ? (
              <AccountRow
                account={selectedAccount}
                useNewUnread={useNewUnread}
              />
            ) : (
              t("web.chat.selectAccount")
            )}
            <div className="relative">
              <ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
              {contact &&
                (useNewUnread
                  ? hasUnread && (
                      <UnreadIndicator className="absolute -right-1 -top-1" />
                    )
                  : hasUnreadMessages(contact, existingAccountIds) && (
                      <UnreadIndicator className="absolute -right-1 -top-1" />
                    ))}
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="min-w-[var(--radix-dropdown-menu-trigger-width)]"
          align="start"
        >
          <DropdownMenuRadioGroup
            value={selectedId}
            onValueChange={(v) => onChange(v)}
          >
            {accounts.map((a) => (
              <DropdownMenuRadioItem key={a.id} value={a.id} className="py-2.5">
                <AccountRow
                  account={a}
                  contactId={contact?.id}
                  status={contact?.telegram?.account?.[a.id]}
                  useNewUnread={useNewUnread}
                />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link
              to="/w/$workspaceId/outreach/sequences/new"
              params={{ workspaceId }}
            >
              <MessageCirclePlus />
              {t("web.chat.newOutreachSequence")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link
              to="/w/$workspaceId/outreach/telegram-accounts/new"
              params={{ workspaceId }}
            >
              <Plus />
              {t("web.chat.addNewAccount")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function NonExistingLeadCard({
  lead,
  accountId,
}: {
  lead: SelectedLead;
  accountId: string;
}) {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const avatarMutation = useMutation(
    trpc.contact.updateContactAvatar.mutationOptions()
  );

  return (
    <div className="flex flex-col items-center gap-2">
      <Avatar className="size-12 shadow-[0_0_4px_rgba(0,0,0,0.24)]">
        <AvatarImage src={lead.avatar}></AvatarImage>
        <AvatarFallback>{lead.fullName[0]}</AvatarFallback>
      </Avatar>
      <p className="gap-1 text-center">
        {lead.type === "group" && (
          <Tip
            content={t("web.contacts.groupChatTooltip")}
            className="relative -top-px inline-flex shrink-0"
          >
            <Users className="text-muted-foreground size-4" />
          </Tip>
        )}{" "}
        {lead.fullName}
      </p>
      <Button
        className="mt-4 border"
        variant="secondary"
        onClick={async () => {
          const contact = await createContact({
            workspaceId,
            ownerId: auth.currentUser!.uid,
            fullName: lead.fullName,
            description: lead.description,
            type: lead.type === "group" ? "group" : "contact",
            telegram: {
              id: Number.parseInt(lead.peerId, 10),
              username: lead.username,
              usernameNormalized: lead.username
                ? normalizeTelegramUsername(lead.username)
                : undefined,
              name: lead.fullName,
              account: {
                [accountId]: {
                  unread: false,
                  unreadCount: 0,
                },
              },
            },
          });
          if (lead.avatar) {
            await avatarMutation.mutateAsync({
              workspaceId,
              contactId: contact.id,
              avatarUrl: lead.avatar,
            });
          }
        }}
      >
        {t("web.chat.createLeadInCrm")}
      </Button>
    </div>
  );
}
