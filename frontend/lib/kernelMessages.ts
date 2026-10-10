/**
 * Разбор вывода Jupyter-ядра в сообщения для чата «топик → тело → получатели».
 *
 * Ядро возвращает только текст (stdout ячеек), поэтому сообщения восстанавливаются
 * из того, что печатают скрипты. Два источника, по убыванию надёжности:
 *
 * 1. Маркер — строка `@@ST_MSG {json}`. Скрипт печатает её сам:
 *      print("@@ST_MSG " + json.dumps({"topic": T, "body": B, "recipients": [...]}))
 *    Поля: topic (обязательно), body, recipients, headers, key, partition, offset.
 *    Это точный путь — для новых скриптов.
 * 2. Узнавание по привычным строкам текущих скриптов:
 *    - доставка: «✅ → mcp-in partition=0 offset=5», «✅ Отправлено topic=X …»,
 *      «✅ Доставлено | topic=X | partition=0 | offset=5», «… → X partition=… key=K»;
 *    - тело: последний JSON-блок перед строкой доставки (json.dumps(..., indent=2));
 *    - получатели: «Адресат: …», «MCP Server: …», поля recipient* в теле;
 *    - заголовки: блок «Заголовки:» со строками «имя   значение».
 *
 * Всё, что не стало сообщением, уходит в служебный вывод — он свёрнут в чате и
 * целиком виден во вкладке «Лог».
 */

export interface KernelLine {
  ts:   string;
  kind: "stdout" | "error" | "system";
  text: string;
}

export interface ChatMessage {
  type:       "message";
  ts:         string;
  topic:      string;
  body:       unknown;            // разобранный JSON или null
  bodyText:   string;             // как показать тело (JSON с отступами или текст)
  recipients: string[];
  headers:    Record<string, string>;
  key?:       string;
  partition?: string;
  offset?:    string;
}

export interface ChatService {
  type:  "service";
  ts:    string;
  lines: string[];
  error: boolean;
}

export type ChatItem = ChatMessage | ChatService;

const MARKER = "@@ST_MSG ";

// «topic=X» (с разделителями «|» или пробелами) — ✅ Отправлено/Доставлено
const TOPIC_KV_RE = /topic=([^\s|,]+)/;
// «→ X partition=0 offset=5» — ✅ → / ✅ Отправлено →
const ARROW_RE = /→\s*([^\s|,]+)\s+partition=/;
const PARTITION_RE = /partition=(\d+)/;
const OFFSET_RE = /offset=(\d+)/;
const KEY_RE = /\bkey=([^\s|,]+)/;

const RECIPIENT_RE = /^\s*(?:Адресат|MCP Server|Получатель|Recipient)\s*:\s*(.+?)\s*$/i;
const HEADERS_START_RE = /^\s*Заголовки\s*:\s*$/;
const HEADER_LINE_RE = /^\s+(\S+)\s+(.+?)\s*$/;
const ERROR_RE = /^(?:❌|Traceback|\w*Error:)/;
const JSON_START_RE = /^(?:[[{]\s*$|\{"|\{\}|\[\{|\["|\[\])/;

/** Ключи тела, в которых лежат получатели. */
const RECIPIENT_KEY_RE = /recipient|адресат|получател/i;

function collectRecipients(body: unknown, out: Set<string>, depth = 0): void {
  if (depth > 3 || body === null || typeof body !== "object") return;
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (RECIPIENT_KEY_RE.test(k)) {
      if (typeof v === "string" && v.trim()) out.add(v.trim());
      else if (Array.isArray(v)) {
        for (const x of v) {
          if (typeof x === "string" && x.trim()) out.add(x.trim());
          else if (x && typeof x === "object") {
            const o = x as Record<string, unknown>;
            const label = o.name ?? o.login ?? o.email ?? o.id;
            if (label != null) out.add(String(label));
          }
        }
      }
    } else if (v && typeof v === "object") {
      collectRecipients(v, out, depth + 1);
    }
  }
}

function bodyToText(body: unknown): string {
  if (body === null || body === undefined) return "";
  if (typeof body === "string") return body;
  try { return JSON.stringify(body, null, 2); } catch { return String(body); }
}

/** Баланс скобок JSON-блока без учёта скобок внутри строк. */
function bracketDelta(line: string): number {
  let d = 0, inStr = false, esc = false;
  for (const ch of line) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") d++;
    else if (ch === "}" || ch === "]") d--;
  }
  return d;
}

export function parseKernelOutput(lines: KernelLine[]): ChatItem[] {
  const items: ChatItem[] = [];

  // Состояние живёт через весь вывод: «Адресат» печатается в init-ячейке,
  // а отправка — позже, в loop-ячейке, отдельным куском вывода.
  let recipient = "";
  let headers: Record<string, string> = {};
  let lastJson: { value: unknown; raw: string } | null = null;

  for (const line of lines) {
    if (line.kind !== "stdout") {
      items.push({ type: "service", ts: line.ts, lines: line.text.split("\n"), error: line.kind === "error" });
      continue;
    }

    const service: string[] = [];
    let serviceError = false;
    let jsonBuf: string[] | null = null;
    let jsonDepth = 0;
    let inHeaders = false;

    const flushService = () => {
      const trimmed = service.filter((l, i, a) => l.trim() || (i > 0 && a[i - 1].trim()));
      if (trimmed.some(l => l.trim())) {
        items.push({ type: "service", ts: line.ts, lines: trimmed, error: serviceError });
      }
      service.length = 0;
      serviceError = false;
    };

    const pushMessage = (m: Omit<ChatMessage, "type" | "ts">) => {
      flushService();
      items.push({ type: "message", ts: line.ts, ...m });
    };

    for (const raw of line.text.split("\n")) {
      // Строка доставки внутри «JSON-блока» значит, что блок был не JSON:
      // отдаём накопленное в служебный вывод и разбираем строку как обычно.
      if (jsonBuf && raw.includes("✅")) {
        service.push(...jsonBuf);
        jsonBuf = null;
      }

      // ── JSON-блок продолжается ──
      if (jsonBuf) {
        jsonBuf.push(raw);
        jsonDepth += bracketDelta(raw);
        if (jsonDepth <= 0) {
          const text = jsonBuf.join("\n");
          try { lastJson = { value: JSON.parse(text), raw: text }; }
          catch { service.push(...jsonBuf); }
          jsonBuf = null;
        }
        continue;
      }

      // ── Маркер точного сообщения ──
      if (raw.startsWith(MARKER)) {
        try {
          const m = JSON.parse(raw.slice(MARKER.length)) as Record<string, unknown>;
          const recips = new Set<string>(
            Array.isArray(m.recipients) ? m.recipients.map(String)
              : m.recipients ? [String(m.recipients)] : [],
          );
          collectRecipients(m.body, recips);
          pushMessage({
            topic:      String(m.topic ?? "без топика"),
            body:       m.body ?? null,
            bodyText:   bodyToText(m.body),
            recipients: [...recips],
            headers:    (m.headers as Record<string, string>) ?? {},
            key:        m.key != null ? String(m.key) : undefined,
            partition:  m.partition != null ? String(m.partition) : undefined,
            offset:     m.offset != null ? String(m.offset) : undefined,
          });
          lastJson = null;
          continue;
        } catch { /* не JSON — обычная строка ниже */ }
      }

      // ── Начало JSON-блока: json.dumps(indent=2) начинает с «{»/«[» отдельной
      //    строкой; однострочный JSON — с «{"», «[{», «["». Строки вида
      //    «[label] текст» под это не попадают.
      if (JSON_START_RE.test(raw)) {
        const delta = bracketDelta(raw);
        if (delta <= 0) {
          try { lastJson = { value: JSON.parse(raw), raw }; continue; } catch { /* ниже */ }
        } else {
          jsonBuf = [raw];
          jsonDepth = delta;
          continue;
        }
      }

      // ── Заголовки Kafka ──
      if (HEADERS_START_RE.test(raw)) { inHeaders = true; headers = {}; continue; }
      if (inHeaders) {
        const h = raw.match(HEADER_LINE_RE);
        if (h) { headers[h[1]] = h[2]; continue; }
        inHeaders = false;
      }

      // ── Получатель ──
      const r = raw.match(RECIPIENT_RE);
      if (r) { recipient = r[1]; service.push(raw); continue; }

      // ── Доставка в топик ──
      const topic = raw.match(ARROW_RE)?.[1] ?? (raw.includes("✅") ? raw.match(TOPIC_KV_RE)?.[1] : undefined);
      if (topic) {
        const recips = new Set<string>(recipient ? [recipient] : []);
        collectRecipients(lastJson?.value, recips);
        pushMessage({
          topic,
          body:       lastJson?.value ?? null,
          bodyText:   lastJson ? bodyToText(lastJson.value) : "",
          recipients: [...recips],
          headers:    { ...headers },
          key:        raw.match(KEY_RE)?.[1],
          partition:  raw.match(PARTITION_RE)?.[1],
          offset:     raw.match(OFFSET_RE)?.[1],
        });
        lastJson = null;
        continue;
      }

      if (ERROR_RE.test(raw.trim())) serviceError = true;
      service.push(raw);
    }

    // Незакрытый JSON-блок или тело без доставки — показываем как служебный вывод.
    if (jsonBuf) service.push(...jsonBuf);
    flushService();
  }

  return items;
}

/** Топики в порядке первого появления — «контакты» чата. */
export function chatContacts(items: ChatItem[]): { topic: string; count: number; lastTs: string }[] {
  const map = new Map<string, { topic: string; count: number; lastTs: string }>();
  for (const it of items) {
    if (it.type !== "message") continue;
    const c = map.get(it.topic) ?? { topic: it.topic, count: 0, lastTs: it.ts };
    c.count += 1;
    c.lastTs = it.ts;
    map.set(it.topic, c);
  }
  return [...map.values()];
}
