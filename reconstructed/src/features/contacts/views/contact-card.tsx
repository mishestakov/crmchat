import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { Link } from "@tanstack/react-router";
import { format, isPast, isToday } from "date-fns";
import { Repeat2Icon, UsersIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  HTMLAttributes,
  Ref,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { mergeRefs } from "react-merge-refs";

import { Property, TaskActivityWithId } from "@repo/core/types";

import { DisplayedProperties } from "./displayed-properties";
import { Checkbox } from "@/components/ui/checkbox";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { Tip } from "@/components/ui/tooltip";
import { UnreadBadge } from "@/components/ui/unread-badge";
import { getUnreadCount, hasUnreadMessages } from "@/lib/contact";
import { useWorkspaceStore } from "@/lib/store";
import { EnrichedContact } from "@/lib/store/selectors";
import { cn } from "@/lib/utils";

const ContactCardContext = createContext<
  | {
      item: EnrichedContact;
      displayedProperties: Property[];
      useNewUnread: boolean;
    }
  | undefined
>(undefined);

export function ContactCardRoot({
  ref,
  className,
  item,
  displayedProperties,
  useNewUnread,
  draggable: isDraggable,
  ...props
}: HTMLAttributes<HTMLAnchorElement> & {
  ref?: Ref<HTMLAnchorElement>;
  item: EnrichedContact;
  displayedProperties: Property[];
  useNewUnread: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const innerRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!isDraggable) return;
    return draggable({
      element: innerRef.current!,
      getInitialData: () => ({
        contactId: item.contact.id,
      }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    });
  }, [isDraggable, item.contact.id]);

  return (
    <ContactCardContext.Provider
      value={{ item, displayedProperties, useNewUnread }}
    >
      <Link
        ref={mergeRefs([ref, innerRef])}
        to="/w/$workspaceId/contacts/$contactId"
        params={{
          workspaceId: item.contact.workspaceId,
          contactId: item.contact.id,
        }}
        className={cn(
          "bg-card hover:bg-card/70 text-card-foreground relative flex w-full items-center gap-2 whitespace-normal p-3 transition-colors first:rounded-t-lg last:rounded-b-lg",
          isDragging && "opacity-30",
          className
        )}
        {...props}
      />
    </ContactCardContext.Provider>
  );
}

export function ContactCardContent() {
  const { t } = useTranslation();
  const ctx = useContext(ContactCardContext);
  if (!ctx) {
    throw new Error("ContactCardContent must be used within a ContactCardRoot");
  }

  const { item, displayedProperties, useNewUnread } = ctx;
  const existingAccountIds = useExistingTelegramAccountIds(!useNewUnread);

  return (
    <div className="flex min-w-0 grow items-center justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-1">
          {item.contact.type === "group" && (
            <Tip
              content={t("web.contacts.groupChatTooltip")}
              className="relative -top-px inline-flex shrink-0"
            >
              <UsersIcon className="text-muted-foreground size-3" />
            </Tip>
          )}
          <p className="sensitive w-full truncate text-sm font-medium">
            {item.contact.fullName}
          </p>
        </div>
        {item.nextStep && <NextStep nextStep={item.nextStep} />}
        <DisplayedProperties
          displayedProperties={displayedProperties}
          contact={item.contact}
        />
      </div>
      {useNewUnread
        ? item.unreadCount > 0 && <UnreadBadge count={item.unreadCount} />
        : hasUnreadMessages(item.contact, existingAccountIds) && (
            <UnreadBadge
              count={getUnreadCount(item.contact, existingAccountIds)}
            />
          )}
    </div>
  );
}

function useExistingTelegramAccountIds(enabled: boolean) {
  return useWorkspaceStore((state) => {
    if (!enabled) return EMPTY_SET;
    return new Set(Object.keys(state.telegramAccountsById));
  });
}

const EMPTY_SET: ReadonlySet<string> = new Set();

export function ContactCardAvatar({ className }: { className?: string }) {
  const ctx = useContext(ContactCardContext);
  if (!ctx) {
    throw new Error("ContactCardContent must be used within a ContactCardRoot");
  }
  return (
    <ContactAvatar
      contact={ctx.item.contact}
      className={cn("size-9", className)}
    />
  );
}

export function ContactCardCheckbox({
  visible,
  selected,
  onSelect,
}: {
  visible: boolean | undefined;
  selected: boolean | "indeterminate" | undefined;
  onSelect: ((selected: boolean) => void) | undefined;
}) {
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.label
          className="-mr-2"
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: "auto" }}
          exit={{ opacity: 0, width: 0 }}
          transition={{ duration: 0.2 }}
        >
          <Checkbox
            className="mr-2"
            checked={selected}
            onCheckedChange={onSelect}
          />
        </motion.label>
      )}
    </AnimatePresence>
  );
}

function NextStep({
  nextStep,
  className,
}: {
  nextStep: TaskActivityWithId;
  className?: string;
}) {
  const date = nextStep.task.dueDate.toDate();
  const today = isToday(date);
  const overdue = isPast(date);

  return (
    <div className={cn("text-muted-foreground min-w-0 flex-1", className)}>
      <div className="line-clamp-1 overflow-hidden text-ellipsis whitespace-normal break-words text-sm">
        {nextStep.task.recurrence?.rule && (
          <Repeat2Icon className="mb-[2px] mr-1 inline-block size-3 align-middle" />
        )}
        <span
          className={cn("text-muted-foreground", overdue && "text-destructive")}
        >
          {today ? "Today" : format(date, "MMM d")}
        </span>
        <span> • </span>
        <span className="sensitive">{nextStep.task.summary}</span>
      </div>
    </div>
  );
}
