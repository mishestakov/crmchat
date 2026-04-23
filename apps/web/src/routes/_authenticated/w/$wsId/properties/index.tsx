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

  // Системные (internal=true) поля скрыты со страницы — юзер их не создавал и
  // не управляет ими в обычном смысле. Исключение — `stage`: на нём строится канбан,
  // юзер реально настраивает его опции (стадии воронки) и переименовывает.
  const items = (list.data ?? []).filter(
    (p) => !p.internal || p.key === "stage",
  );

  // motion Reorder требует controlled values. Обновляем кэш React Query
  // (он же source-of-truth) → motion видит новый порядок, анимирует.
  // PATCH-и шлём после drag-end (а не на каждый swap).
  //
  // Order глобально-уникален: visible идут первыми (в drag-порядке), скрытые
  // hidden internal — после, sequential 0..N-1. Иначе sort `ORDER BY order` в
  // БД получает коллизии (visible.order=0, full_name.order=0), tie ломается
  // через createdAt и порядок «не сохраняется» после рефетча.
  const onReorder = (ordered: Property[]) => {
    qc.setQueryData<Property[]>(propertiesKey(wsId), (prev) => {
      if (!prev) return prev;
      const orderedIds = new Set(ordered.map((p) => p.id));
      const rest = prev.filter((p) => !orderedIds.has(p.id));
      return [...ordered, ...rest].map((p, i) => ({ ...p, order: i }));
    });
  };

  const persistOrder = () => {
    const cached = qc.getQueryData<Property[]>(propertiesKey(wsId));
    if (!cached) return;
    // Шлём весь порядок — diff с `list.data` не работает, т.к. это та же React Query
    // кэш, и onReorder уже обновил её через setQueryData → к моменту onDragEnd
    // closure ловит уже-новый list.data → diff пустой → ничего не уходило в БД.
    // Для ~10 properties N round-trip'ов незаметны.
    const newOrder = cached.map((p, i) => ({ id: p.id, order: i }));
    reorder.mutate({ newOrder });
  };

  return (
    <div className="mx-auto max-w-xl p-6 space-y-4">
      {list.isLoading && <p className="text-sm">Загрузка…</p>}
      {list.error && (
        <p className="text-red-600">{errorMessage(list.error)}</p>
      )}

      {list.data && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {items.length > 0 && (
            <Reorder.Group
              as="ul"
              axis="y"
              values={items}
              onReorder={onReorder}
              className="divide-y divide-zinc-100"
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
          )}

          <Link
            to="/w/$wsId/properties/new"
            params={{ wsId }}
            className={
              "flex items-center gap-3 px-5 py-3 text-sm text-zinc-600 hover:bg-zinc-50 " +
              (items.length > 0 ? "border-t border-zinc-100" : "")
            }
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
      className="flex cursor-pointer select-none items-center gap-3 bg-white px-5 py-3 hover:bg-zinc-50"
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
      <div className="flex flex-1 items-center gap-2">
        <span>{props.property.name}</span>
        {props.property.key === "stage" && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
            воронка
          </span>
        )}
      </div>
      <span className="text-2xl leading-none text-zinc-300">›</span>
    </Reorder.Item>
  );
}
