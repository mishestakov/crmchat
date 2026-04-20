import {
  CheckCheckIcon,
  CheckIcon,
  EyeIcon,
  MessageCircleIcon,
  MessageCircleReply,
  PencilIcon,
  TrashIcon,
} from "lucide-react";
import { omit } from "radashi";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import {
  DistributiveOmit,
  OutreachMessageContent,
  OutreachSequenceMessage,
} from "@repo/core/types";

import { Button } from "../ui/button";
import { DestructiveButton } from "../ui/destructive-button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "../ui/drawer";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { DocumentMessageMetadata } from "./messages/document-message";
import { MediaMessageMetadata } from "./messages/media-message";
import { TextMessageMetadata } from "./messages/text-message";
import { VoiceMessageMetadata } from "./messages/voice-message";
import { TimelineItem } from "./timeline-item";
import { MessagePreviewDialog } from "@/features/outreach/sequences/preview-message-dialog";
import { cn } from "@/lib/utils";

const MESSAGE_TYPES = [
  TextMessageMetadata,
  MediaMessageMetadata,
  DocumentMessageMetadata,
  VoiceMessageMetadata,
];
const MESSAGE_TYPE_MAP = new Map(
  MESSAGE_TYPES.map((type) => [type.type, type])
);

export type FormOutreachMessage = DistributiveOmit<
  OutreachSequenceMessage,
  "id"
> & {
  id: string | null;
};

export function OutreachMessageForm({
  initialValue,
  onSubmit,
  onCancel,
  onDelete,
  firstMessage,
  sequenceId,
  workspaceId,
}: {
  readonly?: boolean;
  initialValue: FormOutreachMessage;
  onSubmit: (value: FormOutreachMessage) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  onCancel: () => void;
  firstMessage?: boolean;
  sequenceId?: string;
  workspaceId?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const { t } = useTranslation();

  const [isSubmitting, setIsSubmitting] = useState(false);

  const messageMetadata = MESSAGE_TYPE_MAP.get((value.type as any) ?? "text")!;
  const MessageEditor = messageMetadata.editorComponent;

  const [isValid, setIsValid] = useState(
    () => messageMetadata.schema.safeParse(omit(value, ["id", "delay"])).success
  );

  return (
    <TimelineItem
      asChild
      className="bg-background"
      icon={<MessageCircleIcon className="size-4 -rotate-90" />}
      header={
        <div className="flex min-h-10 w-full items-center gap-1.5 whitespace-nowrap">
          <Trans
            i18nKey={
              firstMessage
                ? "web.outreach.sequences.index.firstMessageHeader"
                : "web.outreach.sequences.index.messageHeader"
            }
            components={{
              waitValue: (
                <Input
                  className="box-border h-7 min-h-0 w-12 text-end [appearance:textfield] [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
                  type="number"
                  min={1}
                  value={value.delay.value}
                  onChange={(e) =>
                    setValue((v) => ({
                      ...v,
                      delay: { ...v.delay, value: Number(e.target.value) },
                    }))
                  }
                />
              ),
              waitPeriod: (
                <Select
                  defaultValue={value.delay.period}
                  onValueChange={(val) =>
                    setValue((v) => ({
                      ...v,
                      delay: {
                        ...v.delay,
                        period: val as "days" | "hours" | "minutes",
                      },
                    }))
                  }
                >
                  <SelectTrigger
                    className="bg-card h-7 min-h-0 w-auto px-2"
                    chevronClassName="text-muted-foreground mt-0.5 ml-0.5"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    position="item-aligned"
                    className="font-medium"
                  >
                    <SelectGroup>
                      <SelectItem value="days">
                        {t("web.outreach.sequences.index.period.days", {
                          count: value.delay.value,
                        })}
                      </SelectItem>
                      <SelectItem value="hours">
                        {t("web.outreach.sequences.index.period.hours", {
                          count: value.delay.value,
                        })}
                      </SelectItem>
                      <SelectItem value="minutes">
                        {t("web.outreach.sequences.index.period.minutes", {
                          count: value.delay.value,
                        })}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ),
              messageType: (
                <Select
                  defaultValue={value.type ?? "text"}
                  onValueChange={(selectedValue) => {
                    setIsValid(false);
                    setValue((prev) => {
                      const type = selectedValue as NonNullable<
                        FormOutreachMessage["type"]
                      >;
                      switch (type) {
                        case "text":
                          return {
                            id: prev.id,
                            delay: prev.delay,
                            type,
                            text: "",
                          };
                        case "media":
                          return {
                            id: prev.id,
                            delay: prev.delay,
                            type,
                            media: [],
                            caption: "",
                          };
                        case "document":
                          return {
                            id: prev.id,
                            delay: prev.delay,
                            type,
                            documents: [],
                            caption: "",
                          };
                        case "voice":
                          return {
                            id: prev.id,
                            delay: prev.delay,
                            type,
                            voice: {
                              url: "",
                              mimeType: "",
                              fileSize: 0,
                              duration: 0,
                            },
                          };
                        default:
                          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                          throw new Error(`Unknown message type: ${type}`);
                      }
                    });
                  }}
                >
                  <SelectTrigger
                    className="bg-card h-7 min-h-0 w-auto px-2"
                    chevronClassName="text-muted-foreground mt-0.5 ml-0.5"
                  >
                    <SelectValue>
                      <div className="flex items-center gap-1.5">
                        <messageMetadata.icon className="text-muted-foreground mt-0.5 size-3" />
                        <span className="hidden sm:block">
                          {messageMetadata.label(t)}
                        </span>
                      </div>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    position="item-aligned"
                    className="font-medium"
                  >
                    <SelectGroup>
                      {MESSAGE_TYPES.map(({ type, label, icon: Icon }) => (
                        <SelectItem key={type} value={type}>
                          <div className="flex items-center gap-1.5">
                            <Icon className="text-muted-foreground mt-0.5 size-3" />
                            {label(t)}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ),
            }}
          />
          {onDelete && <DeleteStepDialog onDelete={onDelete} />}
        </div>
      }
    >
      <div className="z-10">
        <MessageEditor
          value={value as never}
          onChange={(v) => {
            const result = messageMetadata.schema.safeParse(v);
            setIsValid(result.success);
            if (!result.success) {
              return;
            }

            setValue((prev) => ({
              id: prev.id,
              delay: prev.delay,
              ...(result.data as OutreachMessageContent),
            }));
          }}
        />
        <div className="mt-4 grid grid-cols-3 gap-2">
          {value.type === "text" && sequenceId && workspaceId ? (
            <MessagePreviewDialog
              messageText={value.text ?? ""}
              sequenceId={sequenceId}
              workspaceId={workspaceId}
            >
              <Button variant="card" className="w-full">
                <EyeIcon className="mr-1.5 size-4" />
                {t("web.outreach.sequences.preview.button")}
              </Button>
            </MessagePreviewDialog>
          ) : (
            <Button variant="card" className="w-full" disabled>
              <EyeIcon className="mr-1.5 size-4" />
              {t("web.outreach.sequences.preview.button")}
            </Button>
          )}
          <Button variant="card" className="w-full" onClick={onCancel}>
            {t("web.cancel")}
          </Button>
          <Button
            disabled={!isValid || isSubmitting}
            variant="default"
            className="w-full"
            onClick={async () => {
              setIsSubmitting(true);
              try {
                await onSubmit(value);
              } finally {
                setIsSubmitting(false);
              }
            }}
          >
            {t("web.outreach.sequences.index.saveButton")}
          </Button>
        </div>
      </div>
    </TimelineItem>
  );
}

export function OutreachMessageRenderer({
  className,
  value,
  onClick,
  firstMessage,
  stats,
  isGroupsOutreach,
}: {
  className?: string;
  value: FormOutreachMessage;
  onClick?: () => void;
  firstMessage: boolean;
  stats?: { sent: number; read: number; replied: number };
  isGroupsOutreach: boolean;
}) {
  const { t } = useTranslation();

  const messageMetadata = MESSAGE_TYPE_MAP.get((value.type as any) ?? "text")!;
  const MessagePreview = messageMetadata.previewComponent;

  return (
    <TimelineItem
      asChild
      className={cn("bg-background", className)}
      onClick={onClick}
      icon={<MessageCircleIcon className="size-4 -rotate-90" />}
      header={
        <div className="flex min-h-10 w-full items-center gap-1.5 whitespace-nowrap pr-3">
          <Trans
            i18nKey={
              firstMessage
                ? "web.outreach.sequences.index.firstMessageHeader"
                : "web.outreach.sequences.index.messageHeader"
            }
            components={{
              waitValue: <>{value.delay.value}</>,
              waitPeriod: (
                <>
                  {t(
                    `web.outreach.sequences.index.period.${value.delay.period}`,
                    { count: value.delay.value }
                  )}
                </>
              ),
              messageType: (
                <>
                  {t(
                    `web.outreach.sequences.messageType.${value.type ?? "text"}`
                  )}
                </>
              ),
            }}
          />
          <PencilIcon className="text-muted-foreground group-hover:text-primary ml-auto size-3" />
        </div>
      }
    >
      <div className="z-10">
        <MessagePreview value={value as never} />
        <div
          className={cn(
            "flex justify-end rounded-lg px-2 pt-1 text-xs transition-opacity duration-700",
            !stats && "opacity-0"
          )}
        >
          {stats ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex gap-4">
                  <div className="text-muted-foreground flex items-center gap-1">
                    <CheckIcon className="size-3" />
                    {stats.sent}
                  </div>
                  {!isGroupsOutreach && (
                    <>
                      <div className="text-muted-foreground flex items-center gap-1">
                        <CheckCheckIcon className="size-3" />
                        {stats.read}
                      </div>
                      <div className="text-muted-foreground flex items-center gap-1">
                        <MessageCircleReply className="size-3" />
                        {stats.replied}
                      </div>
                    </>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent align="end">
                <table className="w-full border-separate border-spacing-0 text-xs">
                  <tbody>
                    <tr>
                      <td className="text-muted-foreground pr-2">
                        {t("web.outreach.sequences.index.stats.sent")}:
                      </td>
                      <td>{stats.sent}</td>
                    </tr>
                    {!isGroupsOutreach && (
                      <>
                        <tr>
                          <td className="text-muted-foreground pr-2">
                            {t("web.outreach.sequences.index.stats.read")}:
                          </td>
                          <td>{stats.read}</td>
                        </tr>
                        <tr>
                          <td className="text-muted-foreground pr-2">
                            {t("web.outreach.sequences.index.stats.replied")}:
                          </td>
                          <td>{stats.replied}</td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </TooltipContent>
            </Tooltip>
          ) : (
            <div className="h-4 w-28" />
          )}
        </div>
      </div>
    </TimelineItem>
  );
}

function DeleteStepDialog({
  onDelete,
}: {
  onDelete: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);
  return (
    <Drawer>
      <DrawerTrigger
        className="text-muted-foreground hover:text-destructive hover:bg-accent ml-auto rounded p-2 text-xs font-normal transition-colors"
        title={t("web.delete")}
      >
        <TrashIcon className="size-3" />
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("web.deleteConfirmTitle")}</DrawerTitle>
          <DrawerDescription asChild>
            <div>
              <p className="mt-2">
                {t("web.outreach.sequences.index.deleteStepConfirmDescription")}
              </p>
              <p className="text-destructive mt-2">
                <strong>{t("web.deleteWarning")}</strong>
              </p>
            </div>
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <DestructiveButton
            enableTimeout={500}
            disabled={isDeleting}
            onClick={async () => {
              setIsDeleting(true);
              try {
                await onDelete();
              } finally {
                setIsDeleting(false);
              }
            }}
          >
            {t("web.outreach.sequences.index.deleteStepButton")}
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
