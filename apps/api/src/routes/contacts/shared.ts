// Общее для секций /contacts (index/chat/share). Только то, что реально
// нужно нескольким секциям — остальное живёт в файле своей секции.
import { z } from "@hono/zod-openapi";

export const WsIdParam = z.object({ wsId: z.string().min(1).max(64), id: z.string().min(1).max(64) });
