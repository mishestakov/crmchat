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
  schedule: (wsId: string) => ["outreach-schedule", wsId] as const,
};
