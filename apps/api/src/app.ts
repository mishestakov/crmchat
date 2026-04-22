import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { devAuth } from "./middleware/dev-auth";
import workspaces from "./routes/workspaces";

type Vars = { Variables: { userId: string } };

export const app = new OpenAPIHono<Vars>();

app.use("*", cors({ origin: ["http://localhost:5173"], credentials: true }));
app.use("/v1/*", devAuth);

app.route("/", workspaces);

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "crmchat API", version: "0.0.0" },
});
