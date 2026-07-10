import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import {
  type LegalEntityType,
  advertiserLine,
  isValidInn,
  innLengthForType,
} from "@repo/core";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { phaseLabel, formatRub } from "./-shared";
import { Chip } from "./-ui";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/campaigns/client/$clientId",
)({
  component: ClientPage,
});

// Реквизиты клиента = юрлицо (структурно, форма ОРД) в таблице legal_entities,
// см. LegalEntityCard. Старый free-text в tracks.properties (inn/legal_entity/
// бухгалтерия/заметки) убран — единый источник теперь один.

function ClientPage() {
  const { wsId, clientId } = Route.useParams();

  const clientsQ = useQuery({
    queryKey: ["tracks", wsId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{wsId}/tracks", {
        params: { path: { wsId } },
      });
      if (error) throw error;
      return data;
    },
  });
  const campaignsQ = useQuery({
    queryKey: ["campaigns", wsId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{wsId}/projects", {
        params: { path: { wsId } },
      });
      if (error) throw error;
      return data;
    },
  });

  const client = clientsQ.data?.find((t) => t.id === clientId);
  const campaigns = (campaignsQ.data ?? []).filter((p) => p.trackId === clientId);

  if (clientsQ.isLoading) {
    return <div className="p-6 text-sm text-zinc-500">Загрузка…</div>;
  }
  if (!client) {
    return <div className="p-6 text-sm text-zinc-500">Клиент не найден.</div>;
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-6">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
          Клиент
        </div>
        <h1 className="text-xl font-semibold">{client.name}</h1>
      </div>

      <LegalEntityCard wsId={wsId} clientId={clientId} />

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">Кампании</h2>
          <Link
            to="/w/$wsId/campaigns/new"
            params={{ wsId }}
            search={{ clientId }}
            className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:text-emerald-800"
          >
            <Plus size={15} /> Новая кампания
          </Link>
        </div>
        {campaigns.length === 0 ? (
          <p className="text-sm text-zinc-500">У клиента пока нет кампаний.</p>
        ) : (
          <div className="space-y-1.5">
            {campaigns.map((p) => (
              <Link
                key={p.id}
                to="/w/$wsId/campaigns/$campaignId"
                params={{ wsId, campaignId: p.id }}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 hover:border-emerald-200"
              >
                <span className="truncate text-sm font-medium text-zinc-900">
                  {p.name}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-sm text-zinc-500">
                    {formatRub(p.budgetAmount)}
                  </span>
                  <Chip tone="violet">{phaseLabel(p.phase)}</Chip>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Юрлицо рекламодателя — структурированные реквизиты (форма ОРД). Один клиент =
// одно юрлицо. Из этих полей собирается строка маркировки в ЕРИД-шаге.
type LegalEntityDraft = {
  type: LegalEntityType;
  name: string;
  inn: string;
  kpp: string;
  ogrn: string;
  city: string;
  address: string;
  phone: string;
};
const EMPTY_ENTITY: LegalEntityDraft = {
  type: "ul",
  name: "",
  inn: "",
  kpp: "",
  ogrn: "",
  city: "",
  address: "",
  phone: "",
};
const ENTITY_TYPES: { value: LegalEntityType; label: string }[] = [
  { value: "ul", label: "Юрлицо" },
  { value: "ip", label: "ИП" },
  { value: "fl", label: "Физлицо / самозанятый" },
  { value: "ful", label: "Иностранное юрлицо" },
  { value: "ffl", label: "Иностранное физлицо" },
];

function LegalEntityCard({ wsId, clientId }: { wsId: string; clientId: string }) {
  const qc = useQueryClient();
  const entityQ = useQuery({
    queryKey: ["legal-entity", wsId, clientId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/tracks/{trackId}/legal-entity",
        { params: { path: { wsId, trackId: clientId } } },
      );
      if (error) throw error;
      // null, если реквизиты ещё не заведены.
      return (data ?? null) as Partial<LegalEntityDraft> | null;
    },
  });

  const server: LegalEntityDraft = {
    ...EMPTY_ENTITY,
    ...Object.fromEntries(
      Object.entries(entityQ.data ?? {}).map(([k, v]) => [k, v ?? ""]),
    ),
    type: (entityQ.data?.type as LegalEntityType) ?? "ul",
  };
  const [draft, setDraft] = useState<LegalEntityDraft | null>(null);
  const cur = draft ?? server;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(server);
  const set = <K extends keyof LegalEntityDraft>(k: K, v: LegalEntityDraft[K]) =>
    setDraft({ ...cur, [k]: v });

  const innLen = innLengthForType(cur.type);
  const innError =
    cur.inn.trim() !== "" &&
    innLen !== null &&
    (cur.inn.trim().length !== innLen || !isValidInn(cur.inn.trim()));

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PUT(
        "/v1/workspaces/{wsId}/tracks/{trackId}/legal-entity",
        {
          params: { path: { wsId, trackId: clientId } },
          body: {
            type: cur.type,
            name: cur.name.trim() || null,
            inn: cur.inn.trim() || null,
            kpp: cur.kpp.trim() || null,
            ogrn: cur.ogrn.trim() || null,
            city: cur.city.trim() || null,
            address: cur.address.trim() || null,
            phone: cur.phone.trim() || null,
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["legal-entity", wsId, clientId] });
      setDraft(null); // ресинк с сервером
    },
  });

  const preview = advertiserLine(cur);

  if (entityQ.isLoading) {
    return (
      <div className="rounded-2xl bg-white p-5 text-sm text-zinc-500 shadow-sm">
        Загрузка реквизитов…
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900">
          Реквизиты рекламодателя
        </h2>
        <p className="text-xs text-zinc-500">
          Подставляются в маркировку ЕРИД. Одно юрлицо на клиента.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500">Тип</span>
          <select
            value={cur.type}
            onChange={(e) => set("type", e.target.value as LegalEntityType)}
            className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          >
            {ENTITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Наименование"
          value={cur.name}
          onChange={(v) => set("name", v)}
          placeholder="ООО «Ромашка» / ИП Вася Пупкин"
        />
        <div>
          <Field
            label={`ИНН${innLen ? ` (${innLen} цифр)` : ""}`}
            value={cur.inn}
            onChange={(v) => set("inn", v)}
            invalid={innError}
          />
          {innError && (
            <p className="mt-0.5 text-[11px] text-red-600">Неверный ИНН</p>
          )}
        </div>
        <Field label="КПП" value={cur.kpp} onChange={(v) => set("kpp", v)} />
        <Field label="ОГРН" value={cur.ogrn} onChange={(v) => set("ogrn", v)} />
        <Field label="Город" value={cur.city} onChange={(v) => set("city", v)} placeholder="Москва" />
        <Field label="Телефон" value={cur.phone} onChange={(v) => set("phone", v)} placeholder="+7…" />
        <Field label="Адрес" value={cur.address} onChange={(v) => set("address", v)} />
      </div>

      {preview && (
        <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          <span className="text-zinc-400">В маркировке: </span>
          {preview}
        </div>
      )}

      {dirty && (
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending || innError}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {save.isPending ? "Сохраняем…" : "Сохранить"}
        </button>
      )}
      {save.error && (
        <p className="text-sm text-red-600">{errorMessage(save.error)}</p>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={
          "w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none " +
          (invalid
            ? "border-red-400 focus:border-red-500"
            : "border-zinc-300 focus:border-emerald-500")
        }
      />
    </label>
  );
}
