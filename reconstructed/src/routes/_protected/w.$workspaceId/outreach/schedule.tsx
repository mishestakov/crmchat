import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  SendingHours,
  SendingScheduleSchema,
  defaultSendingHours,
  defaultSendingSchedule,
} from "@repo/core/types";

import { Form } from "@/components/form/form";
import { MiniAppPage } from "@/components/mini-app-page";
import { Checkbox } from "@/components/ui/checkbox";
import { inputVariants } from "@/components/ui/input";
import { MainButton } from "@/components/ui/main-button";
import {
  Section,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "@/components/ui/section";
import { useAppForm } from "@/hooks/app-form";
import { useNavigateBack } from "@/hooks/useNavigateBack";
import { updateWorkspace } from "@/lib/db/workspaces";
import { useCurrentWorkspace } from "@/lib/store";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/outreach/schedule"
)({
  component: RouteComponent,
});

const is12HourFormat = Intl.DateTimeFormat(navigator.language, {
  hour: "numeric",
}).resolvedOptions().hour12;

const timeOptions = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: is12HourFormat
    ? `${i % 12 || 12} ${i < 12 ? "AM" : "PM"}`
    : `${i.toString().padStart(2, "0")}:00`,
}));

const currentTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const timezoneOptions = [
  ...(currentTimezone === "UTC"
    ? []
    : [{ value: currentTimezone, label: currentTimezone }]),
  {
    value: "UTC",
    label: "UTC",
  },
  { value: "separator", label: "separator", separator: true },
  ...Intl.supportedValuesOf("timeZone")
    .filter((tz) => tz !== currentTimezone && tz !== "UTC")
    .map((tz) => ({
      value: tz,
      label: tz,
    })),
];

function RouteComponent() {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const schedule = useCurrentWorkspace(
    (s) => s.outreachSendingSchedule ?? defaultSendingSchedule
  );
  const navigateBack = useNavigateBack();
  const trpc = useTRPC();

  const { mutate: rescheduleSequences } = useMutation(
    trpc.outreach.rescheduleSequences.mutationOptions()
  );

  const form = useAppForm({
    defaultValues: schedule,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: SendingScheduleSchema,
    },
    onSubmit: async ({ value, formApi }) => {
      await updateWorkspace(workspaceId, {
        outreachSendingSchedule: value,
      });
      toast(t("web.outreach.schedule.saveSuccessToast"));
      navigateBack({
        fallback: {
          to: "/w/$workspaceId/outreach",
          params: { workspaceId },
          replace: true,
        },
      });
      if (formApi.state.isDirty) {
        rescheduleSequences({ workspaceId });
      }
    },
  });

  return (
    <MiniAppPage>
      <Form form={form} className="mb-48 flex flex-col gap-4">
        <Section>
          <SectionHeader>{t("web.outreach.schedule.title")}</SectionHeader>
          <SectionItems>
            <form.AppField
              name="dailySchedule.monday"
              children={(field) => (
                <DayOfWeekItem
                  name={t("web.outreach.schedule.monday")}
                  value={field.state.value}
                  setValue={(v) => field.handleChange(v)}
                />
              )}
            />
            <form.AppField
              name="dailySchedule.tuesday"
              children={(field) => (
                <DayOfWeekItem
                  name={t("web.outreach.schedule.tuesday")}
                  value={field.state.value}
                  setValue={(v) => field.handleChange(v)}
                />
              )}
            />
            <form.AppField
              name="dailySchedule.wednesday"
              children={(field) => (
                <DayOfWeekItem
                  name={t("web.outreach.schedule.wednesday")}
                  value={field.state.value}
                  setValue={(v) => field.handleChange(v)}
                />
              )}
            />
            <form.AppField
              name="dailySchedule.thursday"
              children={(field) => (
                <DayOfWeekItem
                  name={t("web.outreach.schedule.thursday")}
                  value={field.state.value}
                  setValue={(v) => field.handleChange(v)}
                />
              )}
            />
            <form.AppField
              name="dailySchedule.friday"
              children={(field) => (
                <DayOfWeekItem
                  name={t("web.outreach.schedule.friday")}
                  value={field.state.value}
                  setValue={(v) => field.handleChange(v)}
                />
              )}
            />
            <form.AppField
              name="dailySchedule.saturday"
              children={(field) => (
                <DayOfWeekItem
                  name={t("web.outreach.schedule.saturday")}
                  value={field.state.value}
                  setValue={(v) => field.handleChange(v)}
                />
              )}
            />
            <form.AppField
              name="dailySchedule.sunday"
              children={(field) => (
                <DayOfWeekItem
                  name={t("web.outreach.schedule.sunday")}
                  value={field.state.value}
                  setValue={(v) => field.handleChange(v)}
                />
              )}
            />
          </SectionItems>
        </Section>

        <Section>
          <SectionHeader>
            {t("web.outreach.schedule.timezoneHeader")}
          </SectionHeader>

          <form.AppField
            name="timezone"
            children={(field) => (
              <field.ComboboxInput
                className="border-0"
                options={timezoneOptions}
              />
            )}
          />
        </Section>

        <MainButton onClick={() => form.handleSubmit()}>
          {t("web.outreach.schedule.saveButton")}
        </MainButton>
      </Form>
    </MiniAppPage>
  );

  function DayOfWeekItem({
    name,
    value,
    setValue,
  }: {
    name: string;
    value: SendingHours | false;
    setValue: (value: SendingHours | false) => void;
  }) {
    return (
      <SectionItem icon={null} asChild>
        <div>
          <SectionItemTitle asChild>
            <label
              className={cn(
                "flex cursor-pointer items-center gap-2",
                value === false && "text-muted-foreground"
              )}
            >
              <Checkbox
                checked={!!value}
                onCheckedChange={(checked) => {
                  setValue(checked ? defaultSendingHours : false);
                }}
              />
              {name}
            </label>
          </SectionItemTitle>
          <SectionItemValue>
            <TimePicker
              value={value ? value.startHour : defaultSendingHours.startHour}
              onChange={(v) => {
                if (value === false) return;
                setValue({ ...value, startHour: v });
              }}
              disabled={value === false}
              max={value ? value.endHour : defaultSendingHours.endHour}
            />
            —
            <TimePicker
              value={value ? value.endHour : defaultSendingHours.endHour}
              onChange={(v) => {
                if (value === false) return;
                setValue({ ...value, endHour: v });
              }}
              disabled={value === false}
              min={value ? value.startHour : defaultSendingHours.startHour}
            />
          </SectionItemValue>
        </div>
      </SectionItem>
    );
  }
}

function TimePicker({
  value,
  onChange,
  disabled,
  min,
  max,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
}) {
  return (
    <div className="relative w-20">
      <select
        value={value.toString()}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
        className={cn(
          inputVariants({ variant: "none" }),
          "text-foreground w-full appearance-none px-2 py-1"
        )}
        disabled={disabled}
      >
        {timeOptions.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={
              (min !== undefined && min > option.value) ||
              (max !== undefined && max < option.value)
            }
          >
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="text-muted-foreground pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2" />
    </div>
  );
}
