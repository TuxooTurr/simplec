/** Скопировать текст: Clipboard API, иначе запасной способ через скрытое поле (браузер мог не дать доступ). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* нет доступа — запасной способ */ }
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { /* не вышло */ }
  ta.remove();
  return ok;
}
