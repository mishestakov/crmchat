// Централизованные queryKeys для outreach-домена. Несколько страниц
// (list/detail/new) обращаются к одним и тем же endpoint'ам — без констант
// легко рассинхронизировать invalidate-цели и cache-hits.
export const OUTREACH_QK = {
  accounts: (wsId: string) => ["outreach-accounts", wsId] as const,
  tracks: (wsId: string) => ["tracks", wsId] as const,
  projects: (wsId: string) => ["projects", wsId] as const,
  project: (wsId: string, projectId: string) =>
    ["project", wsId, projectId] as const,
  // limit/offset опциональны: producer'ы передают полный ключ,
  // invalidate'ы — без них (prefix-match накроет все страницы).
  projectLeads: (
    wsId: string,
    projectId: string,
    limit?: number,
    offset?: number,
  ) =>
    (limit !== undefined
      ? (["project-leads", wsId, projectId, limit, offset ?? 0] as const)
      : (["project-leads", wsId, projectId] as const)),
  projectAnalytics: (
    wsId: string,
    projectId: string,
    period: number,
    grouping: string = "day",
    viewMode: string = "eventDate",
  ) =>
    [
      "project-analytics",
      wsId,
      projectId,
      period,
      grouping,
      viewMode,
    ] as const,
  sampleLead: (wsId: string, projectId: string, seed: number) =>
    ["project-sample-lead", wsId, projectId, seed] as const,
  schedule: (wsId: string) => ["outreach-schedule", wsId] as const,
};
