// Clipboard API доступен только в secure context (https/localhost) — при
// заходе по http с другой машины writeText кидает, и копирование молча
// «не работает» (кейс теста с Юлей 10.06.26). Фолбэк через скрытую
// textarea + execCommand покрывает http.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
