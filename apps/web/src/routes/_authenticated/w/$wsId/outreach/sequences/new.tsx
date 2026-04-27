import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileInput, FileSpreadsheet, Users } from "lucide-react";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { parseCsv, type ParsedCsv } from "../../../../../../lib/csv";
import { BackButton } from "../../../../../../components/back-button";
import { OUTREACH_QK } from "../../../../../../lib/query-keys";

// Донор-style new-sequence: одно окно, выбор источника + сразу загрузка/настройка.
// Никакого отдельного «сначала список, потом рассылка» — лист создаётся
// прозрачно при finalize, юзер видит только sequence.

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/sequences/new",
)({
  component: NewSequencePage,
});

const SKIP_PROPS_IN_MAPPING = new Set(["stage"]);

const PROPERTY_SYNONYMS: Record<string, string[]> = {
  telegram_username: ["telegram", "tg", "username", "handle"],
  phone: ["phone", "телефон", "номер", "tel", "phone_number", "phonenumber"],
  full_name: ["name", "имя", "fullname", "full_name", "fio", "фио"],
  email: ["email", "e-mail", "mail", "почта"],
  amount: ["amount", "sum", "сумма", "стоимость", "цена"],
  url: ["url", "link", "ссылка", "сайт", "website"],
  description: ["desc", "description", "описание", "note", "заметка"],
};

type Source = "csv" | "crm";

function NewSequencePage() {
  const { wsId } = Route.useParams();
  const [source, setSource] = useState<Source | null>(null);

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-xl font-semibold">Новая рассылка</h1>

        {!source && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SourceCard
              icon={<FileSpreadsheet size={28} className="text-emerald-600" />}
              title="Загрузить CSV"
              subtitle="Файл со списком лидов: telegram-username или телефон + любые свойства"
              onClick={() => setSource("csv")}
            />
            <SourceCard
              icon={<Users size={28} className="text-zinc-400" />}
              title="Из контактов CRM"
              subtitle="Скоро: фильтр по контактам в воркспейсе"
              disabled
            />
          </div>
        )}

        {source === "csv" && <CsvFlow wsId={wsId} onCancel={() => setSource(null)} />}
      </div>
    </div>
  );
}

function SourceCard(props: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={
        "flex flex-col items-start gap-2 rounded-2xl bg-white p-5 text-left shadow-sm transition-colors " +
        (props.disabled
          ? "cursor-not-allowed opacity-60"
          : "hover:border-emerald-400 hover:shadow-md border border-transparent")
      }
    >
      {props.icon}
      <div className="font-medium">{props.title}</div>
      <div className="text-xs text-zinc-500">{props.subtitle}</div>
    </button>
  );
}

function CsvFlow(props: { wsId: string; onCancel: () => void }) {
  const { wsId } = props;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

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

  const [name, setName] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  // Inverted mapping: ключом — CSV-колонка, значением — propertyKey ("" = skip).
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [parseError, setParseError] = useState<string | null>(null);

  const mappableProps = useMemo(
    () =>
      (properties.data ?? []).filter((p) => !SKIP_PROPS_IN_MAPPING.has(p.key)),
    [properties.data],
  );

  // Auto-suggest при появлении и parsed-csv, и workspace-properties.
  useEffect(() => {
    if (!parsed || mappableProps.length === 0) return;
    const map: Record<string, string> = {};
    const claimedColumns = new Set<string>();
    for (const p of mappableProps) {
      const synonyms = [
        ...(PROPERTY_SYNONYMS[p.key] ?? []),
        p.key.toLowerCase(),
        p.name.toLowerCase(),
      ];
      const match = parsed.headers.find((h) => {
        if (claimedColumns.has(h)) return false;
        const lh = h.toLowerCase().trim();
        return synonyms.some((s) => s.toLowerCase() === lh);
      });
      if (match) {
        map[match] = p.key;
        claimedColumns.add(match);
      }
    }
    setColumnMap(map);
  }, [parsed, mappableProps]);

  const handleFile = async (file: File) => {
    setParseError(null);
    setFileName(file.name);
    setColumnMap({});
    if (!name) setName(file.name.replace(/\.csv$/i, ""));
    try {
      const text = await file.text();
      const data = parseCsv(text);
      if (data.headers.length === 0) {
        setParseError("Файл пустой или в неверном формате");
        setParsed(null);
        return;
      }
      setParsed(data);
    } catch (e) {
      setParseError(`Не удалось прочитать файл: ${(e as Error).message}`);
      setParsed(null);
    }
  };

  const propertyMappings = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [col, key] of Object.entries(columnMap)) {
      if (key) m[key] = col;
    }
    return m;
  }, [columnMap]);

  const usernameColumn = propertyMappings.telegram_username;
  const phoneColumn = propertyMappings.phone;
  const hasIdentifier = !!(usernameColumn || phoneColumn);

  const previewRows = useMemo(() => parsed?.rows.slice(0, 5) ?? [], [parsed]);

  // Атомарность невозможна без отдельного бэк-endpoint'а; делаем 2 RPC. Если
  // POST /sequences упадёт после успешного POST /lists — останется orphan list.
  // Это терпимо для MVP: юзер увидит ошибку, перезагрузит, попробует ещё раз —
  // мы загрузим новый список + sequence. Lists в навигации не отображаются,
  // visual-leak'а нет. Под prod — вынести в transactional endpoint.
  const create = useMutation({
    mutationFn: async () => {
      if (!parsed) throw new Error("no file");
      const { data: list, error: listErr } = await api.POST(
        "/v1/workspaces/{wsId}/outreach/lists",
        {
          params: { path: { wsId } },
          body: {
            name: name.trim(),
            sourceType: "csv",
            sourceMeta: {
              fileName: fileName ?? undefined,
              usernameColumn: usernameColumn ?? undefined,
              phoneColumn: phoneColumn ?? undefined,
              columns: parsed.headers,
              propertyMappings,
            },
            rows: parsed.rows,
          },
        },
      );
      if (listErr) throw listErr;

      const { data: seq, error: seqErr } = await api.POST(
        "/v1/workspaces/{wsId}/outreach/sequences",
        {
          params: { path: { wsId } },
          body: { listId: list!.id, name: name.trim() },
        },
      );
      if (seqErr) throw seqErr;
      return seq!;
    },
    onSuccess: (seq) => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequences(wsId) });
      qc.invalidateQueries({ queryKey: OUTREACH_QK.lists(wsId) });
      navigate({
        to: "/w/$wsId/outreach/sequences/$seqId",
        params: { wsId, seqId: seq.id },
      });
    },
  });

  const canSubmit =
    !!parsed && name.trim().length > 0 && hasIdentifier && !create.isPending;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        {!parsed ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 px-6 py-10 text-sm text-zinc-600 hover:border-emerald-500 hover:bg-emerald-50/50"
          >
            <FileInput size={24} className="text-zinc-400" />
            Выберите CSV-файл
          </button>
        ) : (
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-700">
              <FileInput
                size={14}
                className="mr-1 inline-block align-text-bottom text-zinc-400"
              />
              {fileName} · {parsed.rows.length} строк, {parsed.headers.length}{" "}
              колонок
            </span>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-xs text-zinc-500 hover:text-zinc-900"
            >
              Заменить
            </button>
          </div>
        )}
        {parseError && (
          <p className="mt-2 text-sm text-red-600">{parseError}</p>
        )}
      </div>

      {parsed && (
        <>
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <Field label="Название рассылки">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Конференция Q2"
                className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </Field>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
            <div>
              <div className="text-sm font-medium">Маппинг колонок</div>
              <p className="mt-0.5 text-xs text-zinc-500">
                Что означает каждая колонка из файла. Хотя бы одна должна
                быть Telegram username или Телефон — иначе отправлять некуда.
                Несмапленные колонки сохранятся для подстановок типа{" "}
                <code>{"{{Company Name}}"}</code>.
              </p>
            </div>
            {parsed.headers.map((header) => (
              <Field key={header} label={header}>
                <select
                  value={columnMap[header] ?? ""}
                  onChange={(e) =>
                    setColumnMap((prev) => ({
                      ...prev,
                      [header]: e.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">— не используется —</option>
                  {mappableProps.map((p) => (
                    <option
                      key={p.id}
                      value={p.key}
                      disabled={
                        !!propertyMappings[p.key] &&
                        propertyMappings[p.key] !== header
                      }
                    >
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
            {!hasIdentifier && (
              <p className="text-xs text-amber-700">
                Выберите колонку для Telegram username или Телефон.
              </p>
            )}
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="mb-2 text-sm font-medium">Превью первых 5 строк</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 text-zinc-500">
                  <tr>
                    {parsed.headers.map((h) => {
                      const mapped =
                        h === usernameColumn ||
                        h === phoneColumn ||
                        Object.values(propertyMappings).includes(h);
                      return (
                        <th
                          key={h}
                          className={
                            "px-2 py-1.5 text-left font-normal " +
                            (mapped ? "text-emerald-700" : "")
                          }
                        >
                          {h}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={i} className="border-t border-zinc-100">
                      {parsed.headers.map((h) => (
                        <td key={h} className="px-2 py-1.5">
                          {row[h] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {create.error && (
            <p className="text-sm text-red-600">{errorMessage(create.error)}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={props.onCancel}
              disabled={create.isPending}
              className="rounded-xl border border-zinc-300 px-4 py-3 text-sm hover:bg-zinc-50 disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => create.mutate()}
              className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {create.isPending
                ? "Создаём…"
                : `Создать рассылку с ${parsed.rows.length} лидами`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-zinc-600">{props.label}</span>
      {props.children}
    </label>
  );
}
