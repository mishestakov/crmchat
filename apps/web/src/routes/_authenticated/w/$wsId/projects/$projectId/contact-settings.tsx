import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Property } from "@repo/core";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import {
  Section,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
} from "../../../../../../components/section";
import { useProject } from "../../../../../../lib/outreach-queries";
import { OUTREACH_QK, WS_QK } from "../../../../../../lib/query-keys";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/projects/$projectId/contact-settings",
)({
  component: ContactSettingsPage,
});

function ContactSettingsPage() {
  const { wsId, projectId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const seq = useProject(wsId, projectId);

  const properties = useQuery({
    queryKey: ["properties", wsId],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/properties",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const members = useQuery({
    queryKey: WS_QK.members(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{id}/members", {
        params: { path: { id: wsId } },
      });
      if (error) throw error;
      return data;
    },
  });

  const [defaults, setDefaults] = useState<Record<string, unknown>>({});
  const [ownerIds, setOwnerIds] = useState<string[]>([]);

  useEffect(() => {
    if (!seq.data) return;
    setDefaults(seq.data.contactDefaults);
    setOwnerIds(seq.data.contactDefaultOwnerIds);
  }, [seq.data]);

  // Editable свойства — всё кроме owner_id (управляется отдельно через
  // owners-sub-page) и кроме автоматически-заполняемых из лида.
  const editableProps = useMemo<Property[]>(() => {
    if (!properties.data) return [];
    const SKIP = new Set([
      "owner_id",
      "tg_user_id",
      "telegram_username",
      "full_name",
    ]);
    return properties.data.filter((p) => !SKIP.has(p.key));
  }, [properties.data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}",
        {
          params: { path: { wsId, projectId } },
          body: {
            contactDefaults: defaults,
            contactDefaultOwnerIds: ownerIds,
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.project(wsId, projectId) });
      navigate({
        to: "/w/$wsId/projects/$projectId",
        params: { wsId, projectId },
      });
    },
  });

  const isDirty = useMemo(() => {
    if (!seq.data) return false;
    if (JSON.stringify(defaults) !== JSON.stringify(seq.data.contactDefaults)) {
      return true;
    }
    const a = [...ownerIds].sort();
    const b = [...seq.data.contactDefaultOwnerIds].sort();
    return JSON.stringify(a) !== JSON.stringify(b);
  }, [seq.data, defaults, ownerIds]);

  if (seq.isLoading || properties.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-2xl text-sm">Загрузка…</p>
      </div>
    );
  }
  if (seq.error || !seq.data) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-2xl text-red-600">
          {seq.error ? errorMessage(seq.error) : "Рассылка не найдена"}
        </p>
      </div>
    );
  }

  const ownerSummary =
    ownerIds.length === 0
      ? "Создатель рассылки"
      : ownerIds.length === 1
      ? members.data?.find((m) => m.id === ownerIds[0])?.name
        ?? members.data?.find((m) => m.id === ownerIds[0])?.username
        ?? "1 ответственный"
      : `${ownerIds.length} ответственных`;

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold">CRM-автоматизации</h1>

        <Section header="Ответственные за лидов">
          <Link
            to="/w/$wsId/projects/$projectId/contact-settings/owners"
            params={{ wsId, projectId }}
          >
            <SectionItem withChevron>
              <SectionItemTitle>По умолчанию</SectionItemTitle>
              <SectionItemValue>{ownerSummary}</SectionItemValue>
            </SectionItem>
          </Link>
          <SectionItem>
            <p className="text-xs text-zinc-500">
              При нескольких выбранных — назначаются по очереди (round-robin).
            </p>
          </SectionItem>
        </Section>

        <Section header="Значения по умолчанию">
          {editableProps.length === 0 && (
            <SectionItem>
              <SectionItemTitle>
                <span className="text-xs text-zinc-500">
                  Нет настраиваемых свойств. Добавьте custom-поля в «Кастомных
                  полях» воркспейса.
                </span>
              </SectionItemTitle>
            </SectionItem>
          )}
          {editableProps.map((p) => (
            <SectionItem key={p.id}>
              <SectionItemTitle>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-zinc-500">{p.key}</div>
              </SectionItemTitle>
              <DefaultInput
                prop={p}
                value={defaults[p.key]}
                onChange={(v) =>
                  setDefaults((prev) => {
                    const next = { ...prev };
                    if (v === "" || v === null || v === undefined) {
                      delete next[p.key];
                    } else {
                      next[p.key] = v;
                    }
                    return next;
                  })
                }
              />
            </SectionItem>
          ))}
        </Section>

        {save.error && (
          <p className="text-sm text-red-600">{errorMessage(save.error)}</p>
        )}

        {isDirty && (
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {save.isPending ? "Сохраняем…" : "Сохранить"}
          </button>
        )}
      </div>
    </div>
  );
}

function DefaultInput(props: {
  prop: Property;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { prop, value, onChange } = props;
  const common = "rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm";

  if (prop.type === "single_select") {
    return (
      <select
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value || null)}
        className={common}
      >
        <option value="">— не задавать —</option>
        {(prop.values ?? []).map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    );
  }
  if (prop.type === "multi_select") {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="flex flex-wrap gap-1">
        {(prop.values ?? []).map((v) => {
          const checked = arr.includes(v.id);
          return (
            <button
              type="button"
              key={v.id}
              onClick={() =>
                onChange(
                  checked ? arr.filter((x) => x !== v.id) : [...arr, v.id],
                )
              }
              className={
                "rounded-full border px-2 py-0.5 text-xs " +
                (checked
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-zinc-300 text-zinc-600")
              }
            >
              {v.name}
            </button>
          );
        })}
      </div>
    );
  }
  if (prop.type === "number") {
    return (
      <input
        type="number"
        value={typeof value === "number" ? value : ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
        className={common + " w-32 text-right"}
      />
    );
  }
  // text / textarea / tel / url / email — единый input
  return (
    <input
      type="text"
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder="—"
      className={common + " w-48"}
    />
  );
}
