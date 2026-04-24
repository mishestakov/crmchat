import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { paths } from "@repo/api-client";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { OUTREACH_QK } from "../../../../../lib/query-keys";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/schedule",
)({
  component: SchedulePage,
});

type Schedule =
  paths["/v1/workspaces/{wsId}/outreach/schedule"]["get"]["responses"][200]["content"]["application/json"];
type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Пн" },
  { key: "tue", label: "Вт" },
  { key: "wed", label: "Ср" },
  { key: "thu", label: "Чт" },
  { key: "fri", label: "Пт" },
  { key: "sat", label: "Сб" },
  { key: "sun", label: "Вс" },
];

// Базовый набор IANA-tz для select'а; строкой можно ввести любую другую.
const TZ_PRESETS = [
  "Europe/Moscow",
  "Europe/Kaliningrad",
  "Europe/Samara",
  "Asia/Yekaterinburg",
  "Asia/Omsk",
  "Asia/Krasnoyarsk",
  "Asia/Irkutsk",
  "Asia/Yakutsk",
  "Asia/Vladivostok",
  "Asia/Magadan",
  "Asia/Kamchatka",
  "UTC",
];

function SchedulePage() {
  const { wsId } = Route.useParams();
  const qc = useQueryClient();

  const schedule = useQuery({
    queryKey: OUTREACH_QK.schedule(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/schedule",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const [draft, setDraft] = useState<Schedule | null>(null);

  useEffect(() => {
    if (schedule.data) setDraft(schedule.data);
  }, [schedule.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("nothing to save");
      const { data, error } = await api.PATCH(
        "/v1/workspaces/{wsId}/outreach/schedule",
        {
          params: { path: { wsId } },
          body: draft,
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: OUTREACH_QK.schedule(wsId) }),
  });

  if (!draft) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Расписание отправки</h1>
        {schedule.isLoading ? (
          <p className="text-sm text-zinc-500">Загрузка…</p>
        ) : (
          <p className="text-sm text-red-600">
            {errorMessage(schedule.error)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Расписание отправки</h1>
      <p className="text-sm text-zinc-600">
        Окна, в которых отправщик имеет право работать. Сообщения вне окна
        ждут ближайшего разрешённого слота.
      </p>

      <div className="rounded-2xl bg-white p-5 shadow-sm space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm text-zinc-600">Часовой пояс</span>
          <select
            value={draft.timezone}
            onChange={(e) =>
              setDraft({ ...draft, timezone: e.target.value })
            }
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          >
            {TZ_PRESETS.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
            {!TZ_PRESETS.includes(draft.timezone) && (
              <option value={draft.timezone}>{draft.timezone}</option>
            )}
          </select>
        </label>

        <div className="space-y-2">
          {DAYS.map(({ key, label }) => {
            const day = draft.dailySchedule[key];
            const enabled = day !== false;
            return (
              <div key={key} className="flex items-center gap-3 text-sm">
                <label className="flex w-20 shrink-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        dailySchedule: {
                          ...draft.dailySchedule,
                          [key]: e.target.checked
                            ? { startHour: 10, endHour: 20 }
                            : false,
                        },
                      })
                    }
                  />
                  <span className="font-medium">{label}</span>
                </label>
                {enabled ? (
                  <div className="flex items-center gap-2">
                    <HourInput
                      value={day.startHour}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          dailySchedule: {
                            ...draft.dailySchedule,
                            [key]: { ...day, startHour: v },
                          },
                        })
                      }
                    />
                    <span className="text-zinc-500">—</span>
                    <HourInput
                      value={day.endHour}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          dailySchedule: {
                            ...draft.dailySchedule,
                            [key]: { ...day, endHour: v },
                          },
                        })
                      }
                    />
                  </div>
                ) : (
                  <span className="text-zinc-400">не отправляем</span>
                )}
              </div>
            );
          })}
        </div>

        {save.error && (
          <p className="text-sm text-red-600">{errorMessage(save.error)}</p>
        )}

        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {save.isPending ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}

function HourInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
    >
      {Array.from({ length: 25 }, (_, i) => (
        <option key={i} value={i}>
          {i.toString().padStart(2, "0")}:00
        </option>
      ))}
    </select>
  );
}
