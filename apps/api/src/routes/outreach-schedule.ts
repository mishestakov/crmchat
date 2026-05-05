import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { workspaces } from "../db/schema";
import type { WorkspaceVars } from "../middleware/assert-member";

// Расписание окон отправки для outreach. Хранится в workspaces.outreach_schedule.
// Один на workspace — все sequences шлют в одном окне (донор делает так же).
// Worker (фаза 3b) при выборе scheduled_messages смотрит сюда: если текущий
// момент в локальном tz workspace вне окна — пропускает.

const WsParam = z.object({ wsId: z.string().min(1).max(64) });

const HourSchema = z.number().int().min(0).max(24);
const DaySchema = z.union([
  z.literal(false),
  z
    .object({ startHour: HourSchema, endHour: HourSchema })
    .refine((d) => d.endHour > d.startHour, {
      message: "endHour must be > startHour",
    }),
]);

const ScheduleSchema = z
  .object({
    timezone: z.string().min(1),
    dailySchedule: z.object({
      mon: DaySchema,
      tue: DaySchema,
      wed: DaySchema,
      thu: DaySchema,
      fri: DaySchema,
      sat: DaySchema,
      sun: DaySchema,
    }),
  })
  .openapi("OutreachSchedule");

function isValidTimezone(tz: string): boolean {
  // Intl бросит RangeError для невалидной IANA tz. Не ставим костыль — это
  // ровно то, что нам нужно валидировать (Postgres сам по себе не проверит).
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/outreach/schedule",
    tags: ["outreach"],
    request: { params: WsParam },
    responses: {
      200: {
        content: { "application/json": { schema: ScheduleSchema } },
        description: "Schedule",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const [row] = await db
      .select({ outreachSchedule: workspaces.outreachSchedule })
      .from(workspaces)
      .where(eq(workspaces.id, wsId))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "workspace not found" });
    return c.json(row.outreachSchedule);
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/outreach/schedule",
    tags: ["outreach"],
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: ScheduleSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ScheduleSchema } },
        description: "Updated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const body = c.req.valid("json");
    if (!isValidTimezone(body.timezone)) {
      throw new HTTPException(400, { message: "invalid IANA timezone" });
    }
    const [row] = await db
      .update(workspaces)
      .set({ outreachSchedule: body, updatedAt: new Date() })
      .where(eq(workspaces.id, wsId))
      .returning({ outreachSchedule: workspaces.outreachSchedule });
    return c.json(row!.outreachSchedule);
  },
);

export default app;
