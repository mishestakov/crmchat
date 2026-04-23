import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import {
  requireSession,
  type SessionVars,
} from "./middleware/require-session";
import {
  assertMember,
  type WorkspaceVars,
} from "./middleware/assert-member";
import activities from "./routes/activities";
import auth from "./routes/auth";
import contacts from "./routes/contacts";
import me from "./routes/me";
import properties from "./routes/properties";
import workspaces from "./routes/workspaces";

export const app = new OpenAPIHono<{ Variables: SessionVars }>();

app.use(
  "*",
  cors({ origin: ["http://localhost:5173"], credentials: true }),
);

// public: dev login + logout (no session needed)
app.route("/", auth);

// everything below requires a session
const protectedApp = new OpenAPIHono<{ Variables: SessionVars }>();
protectedApp.use("/v1/*", requireSession);
protectedApp.route("/", me);
protectedApp.route("/", workspaces);

// workspace-scoped: requireSession + assertMember
const wsApp = new OpenAPIHono<{ Variables: WorkspaceVars }>();
wsApp.use("/v1/workspaces/:wsId/*", assertMember);
wsApp.route("/", contacts);
wsApp.route("/", properties);
wsApp.route("/", activities);
protectedApp.route("/", wsApp);

app.route("/", protectedApp);

// HTTPException по умолчанию рендерится как application/octet-stream — клиенту
// не распарсить. Униформ JSON-ответ для всех ошибок, чтобы openapi-fetch и
// errorMessage() корректно вытягивали .message.
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ message: err.message }, err.status);
  }
  console.error(err);
  return c.json({ message: "internal error" }, 500);
});

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "crmchat API", version: "0.0.0" },
});
