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
  projectReadiness: (wsId: string, projectId: string) =>
    ["project-readiness", wsId, projectId] as const,
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
  shares: (wsId: string, projectId: string) =>
    ["shares", wsId, projectId] as const,
};

export const WS_QK = {
  members: (wsId: string) => ["workspaces", wsId, "members"] as const,
};

// Стандартный invalidate после mutation на проекте. detail+list — почти
// всегда оба нужны (статус мог поменяться, list рендерит карточки).
// leads — опционально (activate/import — да; pause/resume — нет).
type Qc = { invalidateQueries: (opts: { queryKey: readonly unknown[] }) => unknown };
export function invalidateProject(
  qc: Qc,
  wsId: string,
  projectId: string,
  opts: { leads?: boolean } = {},
): void {
  qc.invalidateQueries({ queryKey: OUTREACH_QK.project(wsId, projectId) });
  qc.invalidateQueries({ queryKey: OUTREACH_QK.projects(wsId) });
  // Чек-лист запуска (draft) зависит от лидов/аккаунтов/сообщений — дёшево
  // инвалидировать всегда (после запуска query не маунтится).
  qc.invalidateQueries({
    queryKey: OUTREACH_QK.projectReadiness(wsId, projectId),
  });
  if (opts.leads) {
    qc.invalidateQueries({ queryKey: OUTREACH_QK.projectLeads(wsId, projectId) });
  }
}
