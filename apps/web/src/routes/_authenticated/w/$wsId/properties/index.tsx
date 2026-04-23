import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Reorder, useDragControls } from "motion/react";
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
  // dragging-флаг — чтобы при отпускании drag клик не открывал карточку.
  const [isDragging, setIsDragging] = useState(false);

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
      // TODO: server-side POST /reorder { ids[] } убрал бы N round-trip'ов.
      await Promise.all(
        args.newOrder.map((p) =>
          api.PATCH("/v1/workspaces/{wsId}/properties/{id}", {
            params: { path: { wsId, id: p.id } },
            body: { order: p.order },
          }),
        ),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: propertiesKey(wsId) }),
  });

  const items = list.data ?? [];

  // motion Reorder требует controlled values. Обновляем кэш React Query
  // (он же source-of-truth) → motion видит новый порядок, анимирует.
  // PATCH-и шлём после drag-end (а не на каждый swap).
  const onReorder = (ordered: Property[]) => {
    qc.setQueryData<Property[]>(
      propertiesKey(wsId),
      ordered.map((p, i) => ({ ...p, order: i })),
    );
  };

  const persistOrder = () => {
    const cached = qc.getQueryData<Property[]>(propertiesKey(wsId));
    if (!cached) return;
    const newOrder = cached
      .map((p, i) => ({ id: p.id, order: i }))
      .filter((x, i) => items[i]?.id !== x.id || items[i]?.order !== x.order);
    if (newOrder.length === 0) return;
    reorder.mutate({ newOrder });
  };

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
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <Reorder.Group
            as="ul"
            axis="y"
            values={items}
            onReorder={onReorder}
            className="divide-y divide-zinc-200"
          >
            {items.map((p) => (
              <PropertyRow
                key={p.id}
                property={p}
                onClick={() => {
                  if (isDragging) return;
                  navigate({
                    to: "/w/$wsId/properties/$propertyId/edit",
                    params: { wsId, propertyId: p.id },
                  });
                }}
                onDragStart={() => setIsDragging(true)}
                onDragEnd={() => {
                  // setTimeout — иначе click срабатывает после drop и открывает карточку.
                  setTimeout(() => setIsDragging(false), 100);
                  persistOrder();
                }}
              />
            ))}
          </Reorder.Group>

          <Link
            to="/w/$wsId/properties/new"
            params={{ wsId }}
            className="flex items-center gap-3 border-t border-zinc-200 px-4 py-3 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            <span className="text-lg leading-none">+</span>
            <span>Новое поле</span>
          </Link>
        </div>
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

function PropertyRow(props: {
  property: Property;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  // dragControls + dragListener=false → drag только когда юзер начал с handle,
  // не вся строка. Иначе click в любую часть тянет вместо открытия.
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={props.property}
      as="li"
      dragListener={false}
      dragControls={controls}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onClick={props.onClick}
      className="flex cursor-pointer items-center gap-3 bg-white px-4 py-3 hover:bg-zinc-50"
    >
      <span
        onPointerDown={(e) => {
          e.stopPropagation();
          controls.start(e);
        }}
        style={{ touchAction: "none" }}
        className="cursor-grab select-none text-zinc-400 hover:text-zinc-600 active:cursor-grabbing"
        title="Перетащите для изменения порядка"
      >
        ⠿
      </span>
      <div className="flex-1 font-medium">{props.property.name}</div>
      <span className="text-2xl leading-none text-zinc-300">›</span>
    </Reorder.Item>
  );
}
