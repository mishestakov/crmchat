import { createApiClient } from "@repo/api-client";

// В dev vite проксирует /v1 → http://localhost:3000 (см. vite.config.ts).
// baseUrl пустой → fetch идёт на тот же origin, cookie летят без CORS-преамбулы.
export const api = createApiClient("");
