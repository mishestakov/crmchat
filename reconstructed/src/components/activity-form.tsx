import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { addDays, format } from "date-fns";
import { Timestamp, deleteField } from "firebase/firestore";
import { Repeat2, XIcon } from "lucide-react";
import { nanoid } from "nanoid";
import { usePostHog } from "posthog-js/react";
import { useCallback } from "react";
import { Trans, useTranslation } from "react-i18next";
import * as z from "zod";

import {
  ActivityWithId,
  ContactWithId,
  NoteActivityWithId,
  TaskActivity,
  TaskActivityWithId,
} from "@repo/core/types";

import { Form } from "./form/form";
import { Alert, AlertDescription } from "./ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppForm } from "@/hooks/app-form";
import { useFormFeatures } from "@/hooks/useFormFeatures";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { mergeDocument, refs } from "@/lib/db";
import { createActivity } from "@/lib/db/activites";
import { getRRule } from "@/lib/rrule";
import { useTRPC } from "@/lib/trpc";

const DEFAULT_DATE = addDays(new Date().setHours(10, 0, 0), 1);

const NoteFormSchema = z.object({
  type: z.literal("note"),
  note: z.object({
    content: z.string().trim().min(1, "Required"),
  }),
});

const TaskFormSchema = z.object({
  type: z.literal("task"),
  task: z.object({
    summary: z.string().min(1, "Required"),
    dueDate: z
      .instanceof(Timestamp, { error: "Select a date" })
      .default(() => Timestamp.fromDate(DEFAULT_DATE)),
    content: z.string().optional().or(z.literal("")),
    completedAt: z.instanceof(Timestamp).nullable().default(null),
    completedBy: z.string().nullable().default(null),
    notified: z.boolean().default(false),
    recurrence: z
      .object({
        id: z.string(),
        rule: z.string().optional(),
      })
      .nullish(),
  }),
});

function NoteForm({
  activity,
  onSubmit,
}: {
  activity?: NoteActivityWithId;
  onSubmit: (values: z.output<typeof NoteFormSchema>) => Promise<void>;
}) {
  const { t } = useTranslation();
  useFormFeatures();
  const form = useAppForm({
    defaultValues: (activity ?? {
      type: "note" as const,
      note: {
        content: "",
      },
    }) satisfies z.input<typeof NoteFormSchema>,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: NoteFormSchema,
    },
    onSubmit: async (e) => {
      const data = NoteFormSchema.parse(e.value);
      await onSubmit(data);
    },
  });

  return (
    <Form form={form} className="flex flex-col justify-center gap-3">
      <form.AppField
        name="note.content"
        children={(field) => (
          <field.FormField label={t("web.activities.note.label")}>
            <field.RichEditorInput
              autoFocus
              placeholder={t("web.activities.note.placeholder")}
            />
          </field.FormField>
        )}
      />
      <form.SubmitMainButton>
        {activity
          ? t("web.activities.updateNote")
          : t("web.activities.createNote")}
      </form.SubmitMainButton>
    </Form>
  );
}

function TaskForm({
  activity,
  onSubmit,
}: {
  activity?: TaskActivityWithId;
  onSubmit: (values: z.output<typeof TaskFormSchema>) => Promise<void>;
}) {
  const { t } = useTranslation();
  useFormFeatures();
  const form = useAppForm({
    defaultValues: (activity ?? {
      type: "task" as const,
      task: {
        summary: "",
        dueDate: Timestamp.fromDate(DEFAULT_DATE),
      },
    }) as z.input<typeof TaskFormSchema>,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: TaskFormSchema,
    },
    onSubmit: async (e) => {
      const data = TaskFormSchema.parse(e.value);
      await onSubmit(data);
    },
  });

  return (
    <Form form={form} className="flex flex-col justify-center gap-3">
      <form.AppField
        name="task.summary"
        children={(field) => (
          <field.FormField label={t("web.activities.task.reminderLabel")}>
            <field.TextInput
              autoFocus
              placeholder={t("web.activities.task.reminderPlaceholder")}
            />
          </field.FormField>
        )}
      />

      <form.AppField
        name="task.dueDate"
        children={(field) => (
          <field.FormField label={t("web.activities.task.date")}>
            <field.TimestampInput />
          </field.FormField>
        )}
      />

      <form.Subscribe
        selector={(state) => state.values.task.dueDate}
        children={(dueDate) => (
          <form.AppField
            name="task.recurrence"
            children={(field) => (
              <field.FormItem>
                <field.FormControl>
                  <RecurrenceInput
                    value={field.state.value}
                    onChange={field.handleChange}
                    date={dueDate?.toDate() ?? DEFAULT_DATE}
                  />
                </field.FormControl>
              </field.FormItem>
            )}
          />
        )}
      />

      <form.AppField
        name="task.content"
        children={(field) => (
          <field.FormField label={t("web.activities.task.description")}>
            <field.RichEditorInput
              placeholder={t("web.activities.task.descriptionPlaceholder")}
            />
          </field.FormField>
        )}
      />

      <form.SubmitMainButton>
        {activity
          ? t("web.activities.updateTask")
          : t("web.activities.createTask")}
      </form.SubmitMainButton>
    </Form>
  );
}

function ActivityForm({
  type,
  activity,
  onSubmit,
}: {
  type: ActivityWithId["type"];
  activity?: ActivityWithId;
  onSubmit: (
    values: z.output<typeof NoteFormSchema | typeof TaskFormSchema>
  ) => Promise<void>;
}) {
  return (
    <>
      {type === "note" && (
        <NoteForm
          activity={activity as NoteActivityWithId | undefined}
          onSubmit={onSubmit}
        />
      )}
      {type === "task" && (
        <TaskForm
          activity={activity as TaskActivityWithId | undefined}
          onSubmit={onSubmit}
        />
      )}
    </>
  );
}

function RecurrenceInput({
  value,
  onChange,
  date,
}: {
  value: TaskActivity["task"]["recurrence"];
  onChange: (value: TaskActivity["task"]["recurrence"]) => void;
  date: Date;
}) {
  const { t } = useTranslation();
  const { rrule, next } = getRRule(value?.rule, date);

  if (value && !value.rule) {
    return null;
  }

  return (
    <div className="mx-3 -mt-1 mb-2 flex items-center gap-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 text-left text-sm transition-colors"
          >
            <Repeat2 className="size-3 shrink-0" />
            {rrule ? (
              <span>
                {t("web.activities.task.repeats")}{" "}
                <span className="text-primary">{rrule.toText()}</span>,{" "}
                {next && (
                  <>
                    {t("web.activities.task.next")}: {format(next, "MMMM do")}
                  </>
                )}
              </span>
            ) : (
              t("web.activities.task.repeatEvery")
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[280px]">
          <DropdownMenuRadioGroup
            value={value?.rule}
            onValueChange={(rule) => {
              onChange(
                rule
                  ? {
                      id: value?.id ?? nanoid(),
                      rule,
                    }
                  : undefined
              );
            }}
          >
            <ReccurenceInputOption rule="RRULE:FREQ=WEEKLY" date={date} />
            <ReccurenceInputOption rule="RRULE:FREQ=MONTHLY" date={date} />
            <ReccurenceInputOption
              rule="RRULE:FREQ=MONTHLY;INTERVAL=3"
              date={date}
            />
            <ReccurenceInputOption rule="RRULE:FREQ=YEARLY" date={date} />
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {rrule && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => onChange(null)}
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

function ReccurenceInputOption({ rule, date }: { rule: string; date: Date }) {
  const { rrule } = getRRule(rule, date);
  return (
    <DropdownMenuRadioItem
      value={rule}
      className="flex flex-row justify-between py-2"
    >
      {rrule.toText()}
      <span className="text-muted-foreground text-right">
        {format(rrule.after(date)!, "MMM do")}
      </span>
    </DropdownMenuRadioItem>
  );
}

export function NewActivityForm({
  contact,
  type,
  onSuccess,
}: {
  contact: ContactWithId;
  type: ActivityWithId["type"];
  onSuccess?: (activity: ActivityWithId) => void;
}) {
  const trpc = useTRPC();
  const posthog = usePostHog();

  const { mutateAsync: scheduleCalendarEventIfPossible } = useMutation(
    trpc.activity.scheduleCalendarEventIfPossible.mutationOptions()
  );

  const onSubmit = useCallback(
    async function onSubmit(
      values: z.output<typeof NoteFormSchema | typeof TaskFormSchema>
    ) {
      if (!contact?.workspaceId) return;

      const activity = await createActivity({
        ...values,
        workspaceId: contact.workspaceId,
        contactId: contact.id,
      });

      posthog?.capture("activity_created", {
        type: values.type,
        source: "web",
        $groups: {
          workspace: contact.workspaceId,
        },
      });

      onSuccess?.(activity);

      await scheduleCalendarEventIfPossible({
        workspaceId: activity.workspaceId,
        activityId: activity.id,
      });
    },
    [
      contact.workspaceId,
      contact.id,
      scheduleCalendarEventIfPossible,
      posthog,
      onSuccess,
    ]
  );

  const { me, membersMap } = useWorkspaceMembers();
  const owner = membersMap.get(contact?.ownerId ?? "");

  return (
    <>
      {owner && me?.userId !== owner.userId && (
        <Alert size="small" className="mb-4">
          <AlertDescription>
            <Trans
              i18nKey="web.willGetNotificationAsOwner"
              values={{
                name: owner.user.name,
              }}
              components={[
                <Link
                  to="/w/$workspaceId/settings/workspace/user/$userId"
                  params={{
                    workspaceId: contact.workspaceId,
                    userId: owner.userId,
                  }}
                  className="font-medium hover:underline"
                />,
              ]}
            />
          </AlertDescription>
        </Alert>
      )}
      <ActivityForm type={type} onSubmit={onSubmit} />
    </>
  );
}

export function EditActivityForm({
  activity,
  onSuccess,
}: {
  activity: ActivityWithId;
  onSuccess?: () => void;
}) {
  const onSubmit = useCallback(
    async (values: z.output<typeof NoteFormSchema | typeof TaskFormSchema>) => {
      if (!activity?.workspaceId) return;

      await mergeDocument(refs.activity(activity.workspaceId, activity.id), {
        task: values.type === "task" ? values.task : deleteField(),
        note: values.type === "note" ? values.note : deleteField(),
      });

      onSuccess?.();
    },
    [activity?.workspaceId, activity?.id, onSuccess]
  );

  return (
    <ActivityForm
      type={activity.type}
      activity={activity}
      onSubmit={onSubmit}
    />
  );
}
