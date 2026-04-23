// openapi-fetch отдаёт error либо как ZodError-обёртку (от @hono/zod-openapi),
// либо как `{ message }` (от HTTPException), либо как обычный Error.
// String(e) на этих объектах даёт "[object Object]" — поэтому достаём руками.

type ZodIssue = {
  message: string;
  path?: (string | number)[];
};

export function errorMessage(e: unknown): string {
  if (!e) return "";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  const o = e as Record<string, unknown>;

  const inner = o.error as Record<string, unknown> | undefined;
  if (inner && Array.isArray(inner.issues)) {
    return (inner.issues as ZodIssue[])
      .map((i) => {
        const path = i.path?.join(".") || "field";
        return `${path}: ${i.message}`;
      })
      .join("; ");
  }

  if (typeof o.message === "string") return o.message;
  return JSON.stringify(e);
}
