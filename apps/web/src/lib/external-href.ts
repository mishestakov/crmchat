// Href из введённой человеком ссылки/адреса (общий: rkn, platform-active,
// contacts/$id, leads — вынесен на 4-м повторе). Чинит битую/отсутствующую
// схему, e-mail → mailto:. Правим только href, сырой текст показываем как есть.
export function externalHref(raw: string): string {
  const u = raw.trim().replace(/^(https?):\/+/i, "$1://");
  if (/^(https?:\/\/|mailto:|tel:)/i.test(u)) return u;
  if (/^[^/\s@]+@[^/\s@]+$/.test(u)) return `mailto:${u}`;
  return `https://${u.replace(/^[/@:]+/, "")}`;
}
