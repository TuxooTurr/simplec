/**
 * Вложения задачи при регистрации в Jira: скриншоты (в том числе вставленные из буфера), видео, логи, архивы.
 *
 * Имя вложения важно: описание дефекта ссылается на скриншот разметкой !имя!, и Jira связывает картинку
 * с описанием только при совпадении имён. Бэкенд при генерации лишь очищает имя (bugs.safe_attachment_name),
 * поэтому даём файлам сразу уникальные «чистые» имена — тогда имя в описании и у вложения совпадает само.
 */

/** Что умеет прочитать ИИ при генерации (agents/file_parser.ALLOWED_EXTENSIONS). Остальное — только в Jira. */
export const PARSEABLE_RE = /\.(pdf|docx?|xlsx?|xml|png|jpe?g|txt|log|md|markdown)$/i;
export const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;

/** Всё, кроме латиницы, цифр, «.», «_», «-», — как bugs._SAFE_NAME_RE: имя должно совпасть с тем, что даст генерация. */
const UNSAFE_RE = /[^A-Za-z0-9._-]+/g;

const pad = (n: number) => String(n).padStart(2, "0");

/** Имя файла из буфера (браузер называет вставку «image.png») — заменяем на понятное и уникальное. */
function pastedName(type: string, n: number, now = new Date()): string {
  const ext = (type.split("/")[1] || "png").replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "png";
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `screenshot-${stamp}${n > 1 ? `-${n}` : ""}.${ext}`;
}

function cleanName(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = (dot > 0 ? name.slice(0, dot) : name).replace(UNSAFE_RE, "_").replace(/^[._-]+|[._-]+$/g, "");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  // Имя без латиницы и цифр («Снимок экрана.png») — после очистки пустое; даём понятное.
  return `${stem || "attachment"}${ext ? `.${ext}` : ""}`;
}

/**
 * Новые файлы к уже приложенным: вставки из буфера получают имя screenshot-ДАТА-ВРЕМЯ, остальные — очищенное;
 * совпадающие имена нумеруются («log.txt», «log-2.txt»). Переименование — копией File, содержимое то же.
 */
export function withUniqueNames(existing: File[], added: File[], now = new Date()): File[] {
  const taken = new Set(existing.map(f => f.name.toLowerCase()));
  let pasted = 0;
  return added.map(f => {
    const generic = /^image\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name) || !f.name;
    let name = generic ? pastedName(f.type, ++pasted, now) : cleanName(f.name);
    if (taken.has(name.toLowerCase())) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
      let i = 2;
      while (taken.has(`${stem}-${i}${ext}`.toLowerCase())) i++;
      name = `${stem}-${i}${ext}`;
    }
    taken.add(name.toLowerCase());
    return name === f.name ? f : new File([f], name, { type: f.type, lastModified: f.lastModified });
  });
}

/** 1536 → «1,5 КБ». */
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0).replace(".", ",")} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
}
