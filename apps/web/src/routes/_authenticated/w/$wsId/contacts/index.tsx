import {
  Link,
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { Property } from "@repo/core";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";

export const Route = createFileRoute("/_authenticated/w/$wsId/contacts/")({
  component: ContactsList,
});

function ContactsList() {
  const { wsId } = Route.useParams();
  const navigate = useNavigate();

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

  const contacts = useQuery({
    queryKey: ["contacts", wsId],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/contacts",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const props = (properties.data ?? []) as Property[];
  const rows = contacts.data ?? [];

  return (
    <div className="mx-auto max-w-5xl p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Список</h1>
        <Link
          to="/w/$wsId/contacts/new"
          params={{ wsId }}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white"
        >
          + Новый
        </Link>
      </div>

      {(properties.isLoading || contacts.isLoading) && <p>Загрузка…</p>}
      {properties.error && (
        <p className="text-red-600">{errorMessage(properties.error)}</p>
      )}
      {contacts.error && (
        <p className="text-red-600">{errorMessage(contacts.error)}</p>
      )}

      {contacts.data && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-300 text-left">
              <th className="py-2 pr-4">Имя</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Телефон</th>
              <th className="py-2 pr-4">Telegram</th>
              {props.map((p) => (
                <th key={p.id} className="py-2 pr-4">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={4 + props.length}
                  className="py-4 text-zinc-500"
                >
                  Пока пусто
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() =>
                  navigate({
                    to: "/w/$wsId/contacts/$id",
                    params: { wsId, id: r.id },
                  })
                }
                className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50"
              >
                <td className="py-2 pr-4">{r.name ?? "—"}</td>
                <td className="py-2 pr-4">{r.email ?? "—"}</td>
                <td className="py-2 pr-4">{r.phone ?? "—"}</td>
                <td className="py-2 pr-4">{r.telegramUsername ?? "—"}</td>
                {props.map((p) => (
                  <td key={p.id} className="py-2 pr-4">
                    {renderValue(p, (r.properties as Record<string, unknown>)[p.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function renderValue(p: Property, raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "—";
  if (p.type === "single_select" && p.values) {
    const opt = p.values.find((v) => v.id === raw);
    return opt?.name ?? String(raw);
  }
  return String(raw);
}
