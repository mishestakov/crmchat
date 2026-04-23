import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Property } from "@repo/core";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";

export const Route = createFileRoute("/_authenticated/w/$wsId/properties/")({
  component: PropertiesList,
});

const propertiesKey = (wsId: string) => ["properties", wsId] as const;

function PropertiesList() {
  const { wsId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const list = useQuery({
    queryKey: propertiesKey(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/properties",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const reorder = useMutation({
    mutationFn: async (args: { newOrder: { id: string; order: number }[] }) => {
      await Promise.all(
        args.newOrder.map((p) =>
          api.PATCH("/v1/workspaces/{wsId}/properties/{id}", {
            params: { path: { wsId, id: p.id } },
            body: { order: p.order },
          }),
        ),
      );
    },
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: propertiesKey(wsId) });
      const prev = qc.getQueryData<Property[]>(propertiesKey(wsId));
      if (prev) {
        const orderById = new Map(args.newOrder.map((x) => [x.id, x.order]));
        const next = prev
          .map((p) =>
            orderById.has(p.id) ? { ...p, order: orderById.get(p.id)! } : p,
          )
          .sort((a, b) => a.order - b.order);
        qc.setQueryData(propertiesKey(wsId), next);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(propertiesKey(wsId), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: propertiesKey(wsId) }),
  });

  const moveTo = (draggedId: string, beforeIdx: number) => {
    const items = list.data ?? [];
    const fromIdx = items.findIndex((p) => p.id === draggedId);
    if (fromIdx < 0) return;
    let toIdx = beforeIdx;
    if (fromIdx < beforeIdx) toIdx = beforeIdx - 1;
    if (fromIdx === toIdx) return;
    const next = [...items];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved!);
    const newOrder = next
      .map((p, i) => ({ id: p.id, order: i }))
      .filter((x, i) => items[i]?.id !== x.id || items[i]?.order !== x.order);
    if (newOrder.length === 0) return;
    reorder.mutate({ newOrder });
  };

  const items = list.data ?? [];

  return (
    <div className="mx-auto max-w-2xl p-8 space-y-3">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Кастомные поля
      </div>

      {list.isLoading && <p className="text-sm">Загрузка…</p>}
      {list.error && (
        <p className="text-red-600">{errorMessage(list.error)}</p>
      )}

      {list.data && (
        <ul className="overflow-hidden rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-200">
          {items.map((p, idx) => (
            <li
              key={p.id}
              onDragOver={(e) => {
                if (!draggingId) return;
                e.preventDefault();
                if (dragOverIdx !== idx) setDragOverIdx(idx);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!draggingId) return;
                moveTo(draggingId, idx);
                setDragOverIdx(null);
              }}
              className={
                "transition-colors " +
                (dragOverIdx === idx && draggingId !== p.id
                  ? "bg-zinc-100"
                  : "")
              }
            >
              <div
                onClick={() =>
                  navigate({
                    to: "/w/$wsId/properties/$propertyId/edit",
                    params: { wsId, propertyId: p.id },
                  })
                }
                className={
                  "flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-zinc-50 " +
                  (draggingId === p.id ? "opacity-40" : "")
                }
              >
                <span
                  draggable
                  onClick={(e) => e.stopPropagation()}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDraggingId(p.id);
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDragOverIdx(null);
                  }}
                  className="cursor-grab select-none text-zinc-400 hover:text-zinc-600 active:cursor-grabbing"
                  title="Перетащите для изменения порядка"
                >
                  ⠿
                </span>
                <div className="flex-1 font-medium">{p.name}</div>
                <span className="text-2xl leading-none text-zinc-300">›</span>
              </div>
            </li>
          ))}
          <li
            onDragOver={(e) => {
              if (!draggingId) return;
              e.preventDefault();
              if (dragOverIdx !== items.length) setDragOverIdx(items.length);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (!draggingId) return;
              moveTo(draggingId, items.length);
              setDragOverIdx(null);
            }}
            className={
              "transition-colors " +
              (dragOverIdx === items.length ? "bg-zinc-100" : "")
            }
          >
            <Link
              to="/w/$wsId/properties/new"
              params={{ wsId }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-zinc-600 hover:bg-zinc-50"
            >
              <span className="text-lg leading-none">+</span>
              <span>Новое поле</span>
            </Link>
          </li>
        </ul>
      )}

      {items.length > 1 && (
        <p className="text-xs text-zinc-500">
          Перетащите элементы за{" "}
          <span className="inline-block align-middle text-zinc-400">⠿</span>,
          чтобы изменить порядок полей.
        </p>
      )}
    </div>
  );
}
