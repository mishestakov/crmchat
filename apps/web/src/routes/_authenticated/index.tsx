import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { CreateWorkspaceSchema } from "@repo/core";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";

export const Route = createFileRoute("/_authenticated/")({
  component: WorkspacesPage,
});

function WorkspacesPage() {
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces");
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST("/v1/workspaces", {
        body: { name },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });

  const form = useForm({
    defaultValues: { name: "" },
    validators: { onChange: CreateWorkspaceSchema },
    onSubmit: async ({ value }) => {
      await create.mutateAsync(value.name);
      form.reset();
    },
  });

  return (
    <div className="mx-auto max-w-2xl p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Workspaces</h1>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.Field name="name">
          {(field) => (
            <input
              className="flex-1 rounded border border-zinc-300 px-3 py-2"
              placeholder="Название воркспейса"
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
      </form>

      {list.isLoading && <p>Загрузка…</p>}
      {list.error && (
        <p className="text-red-600">{errorMessage(list.error)}</p>
      )}
      {list.data && (
        <ul className="space-y-2">
          {list.data.length === 0 && (
            <li className="text-zinc-500">Пока пусто</li>
          )}
          {list.data.map((w) => (
            <li key={w.id}>
              <Link
                to="/w/$wsId/contacts"
                params={{ wsId: w.id }}
                className="block rounded border border-zinc-200 p-3 hover:bg-zinc-50"
              >
                <div className="font-medium">{w.name}</div>
                <div className="text-xs text-zinc-500">{w.id}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
