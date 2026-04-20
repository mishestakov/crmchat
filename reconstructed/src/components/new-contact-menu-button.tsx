import * as Dialog from "@radix-ui/react-dialog";
import * as Portal from "@radix-ui/react-portal";
import { useMutation } from "@tanstack/react-query";
import { LinkProps, useNavigate } from "@tanstack/react-router";
import {
  ExternalLink,
  Forward,
  Loader,
  Plus,
  QrCode,
  Send,
  UserPen,
} from "lucide-react";
import { MotionProps, Variants, m, useIsPresent } from "motion/react";
import { HTMLAttributes, ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { MotionLink } from "./motion";
import { Button } from "./ui/button";
import { VisuallyHidden } from "./ui/visually-hidden";
import { useCanCreateContact } from "@/hooks/subscription";
import { useCurrentWorkspace } from "@/lib/store";
import { isDesktopWebApp, webApp } from "@/lib/telegram";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const bottomFloatingButton = () =>
  `fixed bottom-[calc(100vh-var(--tg-viewport-stable-height,100vh)+1rem)]`;

const bottomFloatingButtonSubMenu = () =>
  `fixed bottom-[calc(100vh-var(--tg-viewport-stable-height,100vh)+5rem)]`;

function ActionMenu({
  children,
  open,
}: {
  children: ReactNode;
  open: boolean;
}) {
  return (
    <m.nav
      className="flex flex-col items-end gap-2"
      initial="hidden"
      animate={open ? "visible" : "hidden"}
      exit="hidden"
      variants={list}
    >
      {children}
    </m.nav>
  );
}

function MenuItem() {}

MenuItem.Link = ({
  children,
  className,
  ...props
}: LinkProps & {
  className?: string;
  children: ReactNode;
}) => {
  return (
    <MotionLink
      className={cn("group flex items-center gap-4 py-1 text-sm", className)}
      variants={item}
      {...props}
    >
      {children}
    </MotionLink>
  );
};

MenuItem.Button = function MenuItemTitle({
  children,
  className,
  ...props
}: MotionProps & HTMLAttributes<HTMLButtonElement>) {
  return (
    <m.button
      type="button"
      className={cn("group flex items-center gap-4 py-1 text-sm", className)}
      variants={item}
      {...props}
    >
      {children}
    </m.button>
  );
};

function MenuItemTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group-hover:bg-primary group-hover:text-primary-foreground rounded-sm bg-gray-900 px-2 py-0.5 text-white shadow-md transition-all group-hover:-translate-x-1 dark:bg-gray-200 dark:text-black",
        className
      )}
    >
      {children}
    </div>
  );
}

function MenuItemIcon({ children }: { children: ReactNode }) {
  return (
    <div className="bg-secondary text-secondary-foreground flex size-12 items-center justify-center rounded-full p-1 shadow-md transition-transform group-hover:-translate-x-1">
      {children}
    </div>
  );
}

export function NewContactMenuButton() {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const workspaceId = useCurrentWorkspace((s) => s.id);
  const { mutateAsync: createContactFromQr, isPending: isQrPending } =
    useMutation(trpc.contact.createContactFromQr.mutationOptions());

  const navigate = useNavigate();
  const canCreateContact = useCanCreateContact();

  useEffect(() => {
    const handler = async ({ data }: { data: string }) => {
      console.info("Parsed QR code data", data);
      webApp?.closeScanQrPopup();
      const result = await createContactFromQr({
        workspaceId,
        qrData: data,
      });
      if (result.success) {
        toast(
          result.type === "new"
            ? t("web.contacts.newLeadCreated")
            : t("web.contacts.leadAlreadyExists")
        );
        navigate({
          to: "/w/$workspaceId/contacts/$contactId",
          params: { workspaceId, contactId: result.contact.id },
        });
      } else {
        toast(t("web.contacts.failedToParseLead"), {
          description: result.error,
        });
      }
    };
    webApp?.onEvent("qrTextReceived", handler);
    return () => {
      webApp?.offEvent("qrTextReceived", handler);
    };
  }, [workspaceId, navigate, createContactFromQr, t]);

  const isPresent = useIsPresent();
  if (!isPresent) return null;

  const handleNewContactClick = () => {
    if (!canCreateContact) {
      navigate({
        to: "/w/$workspaceId/settings/subscription",
        params: { workspaceId },
        search: { minPlan: "pro" },
      });
      return;
    }
    setOpen((o) => !o);
  };

  return (
    <Portal.Root>
      <Dialog.Root open={open} onOpenChange={setOpen} modal>
        <Dialog.Trigger asChild>
          <Button
            asChild
            id="new-contact-button"
            className={cn(
              "right-4 z-[60] flex size-12 rounded-full shadow-[0_0_3px_rgb(0_0_0/0.15)] transition-[bottom,background-color,color]",
              bottomFloatingButton()
            )}
            variant={open ? "destructive" : "default"}
            onClick={handleNewContactClick}
          >
            <m.button
              initial={{ scale: 0 }}
              animate={{
                scale: 1,
                rotate: open ? 45 : 0,
              }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Plus className="!size-6" />
              <span className="sr-only">
                {open ? t("web.contacts.close") : t("web.contacts.newLead")}
              </span>
            </m.button>
          </Button>
        </Dialog.Trigger>
        <Dialog.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          className={cn(
            "right-4 z-50 transition-[bottom]",
            bottomFloatingButtonSubMenu()
          )}
        >
          <VisuallyHidden>
            <Dialog.Title>{t("web.contacts.newLead")}</Dialog.Title>
            <Dialog.Description>
              {t("web.contacts.chooseHowToCreate")}
            </Dialog.Description>
          </VisuallyHidden>
          <ActionMenu open={open}>
            <MenuItem.Button
              onClick={() => {
                if (webApp) {
                  webApp?.openLink(t("web.contacts.forwardMessageLink"), {
                    try_instant_view: true,
                  });
                } else {
                  window.open(t("web.contacts.forwardMessageLink"), "_blank");
                }
              }}
            >
              <MenuItemTitle className="flex items-center gap-1">
                <span>{t("web.contacts.forwardMessage")}</span>
                <ExternalLink className="size-3 opacity-50" />
              </MenuItemTitle>
              <MenuItemIcon>
                <Forward className="size-6" />
              </MenuItemIcon>
            </MenuItem.Button>
            <MenuItem.Link
              to="/w/$workspaceId/settings/telegram-sync"
              params={{ workspaceId }}
            >
              <MenuItemTitle>{t("web.telegramFolderSync")}</MenuItemTitle>
              <MenuItemIcon>
                <Send className="-ml-[3px] mt-[1px] size-6" />
              </MenuItemIcon>
            </MenuItem.Link>
            <MenuItem.Button
              onClick={() => {
                if (isDesktopWebApp || !webApp) {
                  toast(t("web.contacts.useMobileDeviceForQr"));
                } else {
                  webApp?.showScanQrPopup({
                    text: t("web.contacts.scanTelegramQr"),
                  });
                }
              }}
            >
              <MenuItemTitle>{t("web.contacts.scanQr")}</MenuItemTitle>
              <MenuItemIcon>
                {isQrPending ? (
                  <Loader className="size-6 animate-spin" />
                ) : (
                  <QrCode className="size-6" />
                )}
              </MenuItemIcon>
            </MenuItem.Button>
            <MenuItem.Link
              to="/w/$workspaceId/contacts/new"
              params={{ workspaceId }}
            >
              <MenuItemTitle>{t("web.contacts.addManually")}</MenuItemTitle>
              <MenuItemIcon>
                <UserPen className="ml-[4px] size-6" />
              </MenuItemIcon>
            </MenuItem.Link>
          </ActionMenu>
        </Dialog.Content>
      </Dialog.Root>
    </Portal.Root>
  );
}

const list: Variants = {
  visible: {
    opacity: 1,
    transition: {
      duration: 0.1,
      when: "beforeChildren",
      staggerChildren: 0.03,
      staggerDirection: -1,
    },
  },
  hidden: { opacity: 0 },
};

const item: Variants = {
  visible: { opacity: 1, x: 0 },
  hover: { x: -5 },
  hidden: { opacity: 0, x: 20 },
};
