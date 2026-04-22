import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import {
  requireSession,
  type SessionVars,
} from "./middleware/require-session";
import auth from "./routes/auth";
import me from "./routes/me";
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
app.route("/", protectedApp);

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "crmchat API", version: "0.0.0" },
});
