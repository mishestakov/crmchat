import {
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { CreateWorkspaceSchema } from "@repo/core";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";

const workspacesQueryOptions = {
  queryKey: ["workspaces"] as const,
  queryFn: async () => {
    const { data, error } = await api.GET("/v1/workspaces");
    if (error) throw error;
    return data;
  },
};

export const Route = createFileRoute("/_authenticated/")({
  validateSearch: (s: Record<string, unknown>) => ({
    new: s.new === true || s.new === "1" || s.new === "true",
  }),
  beforeLoad: async ({ context, search }) => {
    // ?new=1 → намеренно показываем форму создания, redirect не делаем.
    if (search.new) return;
    // Иначе (default landing) — если уже есть workspace, ведём в него.
    const ws = await context.queryClient.fetchQuery(workspacesQueryOptions);
    if (ws.length > 0) {
      throw redirect({
        to: "/w/$wsId/contacts",
        params: { wsId: ws[0]!.id },
      });
    }
  },
  component: CreateWorkspacePage,
});

function CreateWorkspacePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const create = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST("/v1/workspaces", {
        body: { name },
      });
      if (error) throw error;
      return data!;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      navigate({ to: "/w/$wsId/contacts", params: { wsId: data.id } });
    },
  });

  const form = useForm({
    defaultValues: { name: "" },
    validators: { onChange: CreateWorkspaceSchema },
    onSubmit: async ({ value }) => {
      await create.mutateAsync(value.name);
    },
  });

  return (
    <div className="mx-auto max-w-md p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Создать workspace</h1>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.Field name="name">
          {(field) => (
            <input
              autoFocus
              className="w-full rounded border border-zinc-300 px-3 py-2"
              placeholder="Название workspace"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
        </form.Field>
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-50"
        >
          Создать
        </button>
        {create.error && (
          <p className="text-sm text-red-600">{errorMessage(create.error)}</p>
        )}
      </form>
    </div>
  );
}
