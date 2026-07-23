import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import {
  requireSession,
  type SessionVars,
} from "./middleware/require-session.ts";
import {
  assertMember,
  type WorkspaceVars,
} from "./middleware/assert-member.ts";
import activities from "./routes/activities.ts";
import auth from "./routes/auth.ts";
import campaigns from "./routes/campaigns.ts";
import channels from "./routes/channels/index.ts";
import contacts from "./routes/contacts/index.ts";
import { memberOps, publicInvites, wsInvites } from "./routes/invites.ts";
import me from "./routes/me.ts";
import membersDismiss from "./routes/members-dismiss.ts";
import outreachAccountDelegations from "./routes/outreach-account-delegations.ts";
import outreachAccounts from "./routes/outreach-accounts.ts";
import outreachSchedule from "./routes/outreach-schedule.ts";
import outreachDunning from "./routes/outreach-dunning.ts";
import projects from "./routes/projects/index.ts";
import platformActive from "./routes/platform-active.ts";
import quickSend from "./routes/quick-send.ts";
import rkn from "./routes/rkn.ts";
import shareClient from "./routes/share-client.ts";
import conversationShareClient from "./routes/conversation-share-client.ts";
import shares from "./routes/shares.ts";
import stageTemplates from "./routes/stage-templates.ts";
import stickers from "./routes/stickers.ts";
import tracks from "./routes/tracks.ts";
import legalEntities from "./routes/legal-entities.ts";
import properties from "./routes/properties.ts";
import workspaces from "./routes/workspaces.ts";

export const app = new OpenAPIHono<{ Variables: SessionVars }>();

app.use(
  "*",
  cors({ origin: ["http://localhost:5173"], credentials: true }),
);

// public: dev login + logout (no session needed)
app.route("/", auth);
// public: клиентский magic-link доступ (auth по токену внутри роутера, не
// session). Монтируется ДО protectedApp, чтобы /v1/share/* не попало под
// requireSession.
app.route("/", shareClient);
// public: read-only переписка по magic-link (auth по токену внутри роутера).
// Тоже ДО protectedApp, чтобы /v1/share/conv/* не попало под requireSession.
app.route("/", conversationShareClient);

// everything below requires a session
const protectedApp = new OpenAPIHono<{ Variables: SessionVars }>();
protectedApp.use("/v1/*", requireSession);
protectedApp.route("/", me);
protectedApp.route("/", workspaces);
// Словарь РКН — глобальный (реестр один на всех), только requireSession.
protectedApp.route("/", rkn);
// Справочник «Каналы Яндекса» — тоже глобальный датасет, только requireSession.
protectedApp.route("/", platformActive);
// /v1/invites/:code GET + POST accept — только requireSession, без
// assertMember (приглашённый ещё не member).
protectedApp.route("/", publicInvites);

// workspace-scoped: requireSession + assertMember
const wsApp = new OpenAPIHono<{ Variables: WorkspaceVars }>();
wsApp.use("/v1/workspaces/:wsId/*", assertMember);
wsApp.route("/", channels);
wsApp.route("/", contacts);
wsApp.route("/", properties);
wsApp.route("/", activities);
wsApp.route("/", outreachAccounts);
wsApp.route("/", outreachAccountDelegations);
wsApp.route("/", projects);
wsApp.route("/", campaigns);
wsApp.route("/", shares);
wsApp.route("/", quickSend);
wsApp.route("/", stickers);
wsApp.route("/", tracks);
wsApp.route("/", legalEntities);
wsApp.route("/", stageTemplates);
wsApp.route("/", outreachSchedule);
wsApp.route("/", outreachDunning);
wsApp.route("/", wsInvites);
wsApp.route("/", memberOps);
wsApp.route("/", membersDismiss);
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
