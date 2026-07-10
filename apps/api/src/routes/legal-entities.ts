import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq, isNull } from "drizzle-orm";
import {
  LegalEntityTypeSchema,
  isValidInn,
  innLengthForType,
  type LegalEntityType,
} from "@repo/core";
import { db } from "../db/client.ts";
import { legalEntities, tracks, projects } from "../db/schema.ts";
import { type WorkspaceVars } from "../middleware/assert-member.ts";

// Юрлицо (контрагент) — реквизиты рекламодателя/блогера, форма 1:1 с ОРД
// «Организация». Сейчас endpoint'ы адресуют рекламодателя (юрлицо клиента-трека,
// 1:1). Блогер (contactId) и агентство-self лягут сюда же позже — таблица одна.

const TypeSchema = z.enum(LegalEntityTypeSchema.options);

const LegalEntitySchema = z
  .object({
    id: z.string(),
    trackId: z.string().nullable(),
    contactId: z.string().nullable(),
    type: TypeSchema,
    inn: z.string().nullable(),
    orgForm: z.string().nullable(),
    name: z.string().nullable(),
    kpp: z.string().nullable(),
    ogrn: z.string().nullable(),
    city: z.string().nullable(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    oksmNumber: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("LegalEntity");

// Вход PUT — все поля кроме type опциональны (черновик реквизитов допустим).
// ИНН валидируем по type: формат + контрольная сумма (если задан).
const LegalEntityInputSchema = z
  .object({
    type: TypeSchema,
    inn: z.string().trim().max(12).nullable().optional(),
    orgForm: z.string().trim().max(50).nullable().optional(),
    name: z.string().trim().max(255).nullable().optional(),
    kpp: z.string().trim().max(9).nullable().optional(),
    ogrn: z.string().trim().max(15).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    oksmNumber: z.string().trim().max(3).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.inn) return;
    const len = innLengthForType(v.type as LegalEntityType);
    if (len === null) return; // иностранцы — без ИНН-формата
    if (v.inn.length !== len) {
      ctx.addIssue({
        code: "custom",
        path: ["inn"],
        message: `ИНН должен быть ${len} цифр для этого типа`,
      });
    } else if (!isValidInn(v.inn)) {
      ctx.addIssue({
        code: "custom",
        path: ["inn"],
        message: "Неверная контрольная сумма ИНН",
      });
    }
  })
  .openapi("LegalEntityInput");

const WsTrackParam = z.object({
  wsId: z.string().min(1).max(64),
  trackId: z.string().min(1).max(64),
});
const WsProjectParam = z.object({
  wsId: z.string().min(1).max(64),
  projectId: z.string().min(1).max(64),
});

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

function serialize(row: typeof legalEntities.$inferSelect) {
  return {
    id: row.id,
    trackId: row.trackId,
    contactId: row.contactId,
    type: row.type,
    inn: row.inn,
    orgForm: row.orgForm,
    name: row.name,
    kpp: row.kpp,
    ogrn: row.ogrn,
    city: row.city,
    address: row.address,
    phone: row.phone,
    oksmNumber: row.oksmNumber,
    createdAt: row.createdAt.toISOString(),
  };
}

// Юрлицо рекламодателя = запись с trackId и contactId IS NULL (роль advertiser).
async function advertiserEntity(wsId: string, trackId: string) {
  const [row] = await db
    .select()
    .from(legalEntities)
    .where(
      and(
        eq(legalEntities.workspaceId, wsId),
        eq(legalEntities.trackId, trackId),
        isNull(legalEntities.contactId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// GET реквизитов клиента-трека (для карточки клиента). null — ещё не заведены.
app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/tracks/{trackId}/legal-entity",
    tags: ["legal-entities"],
    request: { params: WsTrackParam },
    responses: {
      200: {
        content: {
          "application/json": { schema: LegalEntitySchema.nullable() },
        },
        description: "Legal entity or null",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { trackId } = c.req.valid("param");
    const row = await advertiserEntity(wsId, trackId);
    return c.json(row ? serialize(row) : null);
  },
);

// PUT (upsert) реквизитов клиента-трека. 1:1 track→юрлицо рекламодателя.
app.openapi(
  createRoute({
    method: "put",
    path: "/v1/workspaces/{wsId}/tracks/{trackId}/legal-entity",
    tags: ["legal-entities"],
    request: {
      params: WsTrackParam,
      body: {
        content: { "application/json": { schema: LegalEntityInputSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: LegalEntitySchema } },
        description: "Upserted",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const { trackId } = c.req.valid("param");
    const body = c.req.valid("json");

    const [track] = await db
      .select({ id: tracks.id })
      .from(tracks)
      .where(and(eq(tracks.id, trackId), eq(tracks.workspaceId, wsId)))
      .limit(1);
    if (!track) throw new HTTPException(404, { message: "track not found" });

    const fields = {
      type: body.type,
      inn: body.inn ?? null,
      orgForm: body.orgForm ?? null,
      name: body.name ?? null,
      kpp: body.kpp ?? null,
      ogrn: body.ogrn ?? null,
      city: body.city ?? null,
      address: body.address ?? null,
      phone: body.phone ?? null,
      oksmNumber: body.oksmNumber ?? null,
    };

    const existing = await advertiserEntity(wsId, trackId);
    if (existing) {
      const [row] = await db
        .update(legalEntities)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(legalEntities.id, existing.id))
        .returning();
      return c.json(serialize(row!));
    }
    const [row] = await db
      .insert(legalEntities)
      .values({ workspaceId: wsId, trackId, createdBy: userId, ...fields })
      .returning();
    return c.json(serialize(row!));
  },
);

// Резолв юрлица рекламодателя для кампании: project → track → юрлицо. Кормит
// ЕРИД-шаг (собирает маркировку из полей). null — реквизиты ещё не заведены.
app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/advertiser",
    tags: ["legal-entities"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: {
          "application/json": { schema: LegalEntitySchema.nullable() },
        },
        description: "Advertiser legal entity or null",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { projectId } = c.req.valid("param");
    const [project] = await db
      .select({ trackId: projects.trackId })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, wsId)))
      .limit(1);
    if (!project) throw new HTTPException(404, { message: "project not found" });
    const row = await advertiserEntity(wsId, project.trackId);
    return c.json(row ? serialize(row) : null);
  },
);

export default app;
