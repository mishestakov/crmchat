import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Send,
  StickyNote,
} from "lucide-react";
import type { Contact, Property } from "@repo/core";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import {
  ActivitiesList,
  NoteModal,
  ReminderModal,
} from "../-activities-section";

export const Route = createFileRoute("/_authenticated/w/$wsId/contacts/$id/")({
  component: ContactDetail,
});

function ContactDetail() {
  const { wsId, id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

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

  const contact = useQuery({
    queryKey: ["contact", wsId, id],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/contacts/{id}",
        { params: { path: { wsId, id } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/contacts/{id}",
        { params: { path: { wsId, id } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", wsId] });
      navigate({ to: "/w/$wsId/contacts", params: { wsId } });
    },
  });

  const [adding, setAdding] = useState<"note" | "reminder" | null>(null);

  if (contact.isLoading || properties.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-xl text-sm">Загрузка…</p>
      </div>
    );
  }
  if (contact.error || !contact.data) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-xl text-red-600">
          {contact.error ? errorMessage(contact.error) : "Контакт не найден"}
        </p>
      </div>
    );
  }

  const props_ = properties.data ?? [];

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto max-w-xl space-y-3">
        <ContactView
          contact={contact.data}
          properties={props_}
          onEdit={() =>
            navigate({
              to: "/w/$wsId/contacts/$id/edit",
              params: { wsId, id },
            })
          }
          onDelete={() => {
            if (confirm("Удалить контакт?")) remove.mutate();
          }}
          onAddNote={() => setAdding("note")}
          onAddReminder={() => setAdding("reminder")}
        />

        <ActivitiesList wsId={wsId} contactId={id} />
      </div>

      {adding === "note" && (
        <NoteModal
          wsId={wsId}
          contactId={id}
          onClose={() => setAdding(null)}
        />
      )}
      {adding === "reminder" && (
        <ReminderModal
          wsId={wsId}
          contactId={id}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}

function ContactView(props: {
  contact: Contact;
  properties: Property[];
  onEdit: () => void;
  onDelete: () => void;
  onAddNote: () => void;
  onAddReminder: () => void;
}) {
  const { contact, properties } = props;
  return (
    <>
      <div className="relative rounded-2xl bg-white px-6 pb-5 pt-6 shadow-sm">
        <div className="absolute right-3 top-3">
          <CardMenu onEdit={props.onEdit} onDelete={props.onDelete} />
        </div>
        <div className="flex flex-col items-center text-center">
          <h1 className="text-xl font-semibold">
            {contact.name || "Без имени"}
          </h1>
          <SocialRow contact={contact} />
        </div>
      </div>

      {properties.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {properties.map((p, i) => (
            <div
              key={p.id}
              className={
                "flex items-center justify-between gap-4 px-5 py-3 text-sm " +
                (i < properties.length - 1
                  ? "border-b border-zinc-100"
                  : "")
              }
            >
              <span className="text-zinc-500">{p.name}</span>
              <div className="text-right text-zinc-900">
                {renderPropertyValue(
                  p,
                  (contact.properties as Record<string, unknown>)[p.key],
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 divide-x divide-zinc-100 overflow-hidden rounded-2xl bg-white shadow-sm">
        <ActionButton
          icon={<StickyNote size={20} />}
          label="Добавить заметку"
          onClick={props.onAddNote}
        />
        <ActionButton
          icon={<Bell size={20} />}
          label="Добавить напоминание"
          onClick={props.onAddReminder}
        />
        <ActionButton
          icon={<MessageCircle size={20} />}
          label="Открыть чат"
          disabled
        />
      </div>
    </>
  );
}

function SocialRow({ contact }: { contact: Contact }) {
  const links: { href: string; icon: React.ReactNode; bg: string }[] = [];
  if (contact.email) {
    links.push({
      href: `mailto:${contact.email}`,
      icon: <Mail size={14} />,
      bg: "bg-zinc-500",
    });
  }
  if (contact.phone) {
    links.push({
      href: `tel:${contact.phone}`,
      icon: <Phone size={14} />,
      bg: "bg-zinc-500",
    });
  }
  if (contact.telegramUsername) {
    const u = contact.telegramUsername.replace(/^@/, "");
    links.push({
      href: `https://t.me/${u}`,
      icon: <Send size={14} />,
      bg: "bg-sky-500",
    });
  }
  if (links.length === 0) return null;
  return (
    <div className="mt-3 flex justify-center gap-2">
      {links.map((l, i) => (
        <a
          key={i}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          className={
            "inline-flex h-7 w-7 items-center justify-center rounded-full text-white hover:opacity-90 " +
            l.bg
          }
        >
          {l.icon}
        </a>
      ))}
    </div>
  );
}

function ActionButton(props: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={
        "flex flex-col items-center justify-center gap-1.5 px-3 py-4 text-center text-xs leading-tight " +
        (props.disabled
          ? "cursor-not-allowed text-zinc-400"
          : "text-zinc-700 hover:bg-zinc-50")
      }
    >
      <span className={props.disabled ? "text-zinc-300" : "text-emerald-600"}>
        {props.icon}
      </span>
      {props.label}
    </button>
  );
}

function CardMenu(props: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              props.onEdit();
            }}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
          >
            Редактировать
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              props.onDelete();
            }}
            className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-zinc-50"
          >
            Удалить
          </button>
        </div>
      )}
    </div>
  );
}

function renderPropertyValue(p: Property, raw: unknown): React.ReactNode {
  if (raw === undefined || raw === null || raw === "") {
    return <span className="text-zinc-400">—</span>;
  }
  if (p.type === "single_select" && p.values) {
    const opt = p.values.find((v) => v.id === raw);
    return opt?.name ?? <span className="text-zinc-400">—</span>;
  }
  if (p.type === "multi_select" && Array.isArray(raw)) {
    if (raw.length === 0) return <span className="text-zinc-400">—</span>;
    const names = raw.map((id) =>
      typeof id === "string"
        ? p.values?.find((v) => v.id === id)?.name ?? id
        : String(id),
    );
    return names.join(", ");
  }
  return String(raw);
}
