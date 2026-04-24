import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRight, FileInput, UserRound, UsersRound } from "lucide-react";
import { BackButton } from "../../../../../../../components/back-button";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/lists/new/",
)({
  component: NewListSourcePicker,
});

function NewListSourcePicker() {
  const { wsId } = Route.useParams();
  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto max-w-md space-y-3">
        <h1 className="text-xl font-semibold">Откуда взять лидов</h1>

        <Link
          to="/w/$wsId/outreach/lists/new/csv"
          params={{ wsId }}
          className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm hover:bg-zinc-50"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <FileInput size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">CSV-файл</div>
            <div className="text-xs text-zinc-500">
              Загрузите файл с колонками username/phone
            </div>
          </div>
          <ChevronRight size={16} className="text-zinc-400" />
        </Link>

        <div className="flex cursor-not-allowed items-center gap-3 rounded-2xl bg-white p-4 opacity-50 shadow-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
            <UserRound size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Лиды из CRM</div>
            <div className="text-xs text-zinc-500">Скоро (фаза 3)</div>
          </div>
        </div>

        <div className="flex cursor-not-allowed items-center gap-3 rounded-2xl bg-white p-4 opacity-50 shadow-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
            <UsersRound size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Группы из CRM</div>
            <div className="text-xs text-zinc-500">Скоро</div>
          </div>
        </div>
      </div>
    </div>
  );
}
