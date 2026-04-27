// Централизованные queryKeys для outreach-домена. Несколько страниц
// (list/detail/new) обращаются к одним и тем же endpoint'ам — без констант
// легко рассинхронизировать invalidate-цели и cache-hits.
export const OUTREACH_QK = {
  accounts: (wsId: string) => ["outreach-accounts", wsId] as const,
  lists: (wsId: string) => ["outreach-lists", wsId] as const,
  list: (wsId: string, listId: string) =>
    ["outreach-list", wsId, listId] as const,
  leads: (wsId: string, listId: string) =>
    ["outreach-leads", wsId, listId] as const,
  sequences: (wsId: string) => ["outreach-sequences", wsId] as const,
  sequence: (wsId: string, seqId: string) =>
    ["outreach-sequence", wsId, seqId] as const,
  sequenceLeads: (wsId: string, seqId: string) =>
    ["outreach-sequence-leads", wsId, seqId] as const,
  sequenceAnalytics: (
    wsId: string,
    seqId: string,
    period: number,
    grouping: string = "day",
    viewMode: string = "eventDate",
  ) =>
    [
      "outreach-sequence-analytics",
      wsId,
      seqId,
      period,
      grouping,
      viewMode,
    ] as const,
  sampleLead: (wsId: string, seqId: string, seed: number) =>
    ["outreach-sample-lead", wsId, seqId, seed] as const,
  schedule: (wsId: string) => ["outreach-schedule", wsId] as const,
};
