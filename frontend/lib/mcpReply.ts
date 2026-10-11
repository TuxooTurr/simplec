/**
 * Ответы MCP из топика mcp-out — в чат.
 *
 * MCP-скрипты только отправляют запрос в mcp-in и печатают подсказку
 * «🔎 Ответ в mcp-out по id: <uuid>» (или список «значение → <uuid>»): сами ответ
 * не читают. Поэтому SimpleTest после запуска находит эти id в выводе и запускает
 * в том же ядре короткое чтение mcp-out — с теми же брокерами и настройками Kafka,
 * что у скрипта (берутся из его producer / BROKERS). Найденный ответ печатается
 * маркером @@ST_MSG — чат показывает его сообщением от топика mcp-out.
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HINT_RE = /mcp-out[^\n]*?по\s+id/i;

/** id запросов, ответы на которые скрипт предлагает искать в mcp-out. */
export function extractMcpReplyIds(output: string): string[] {
  const at = output.search(HINT_RE);
  if (at < 0) return [];
  return Array.from(new Set((output.slice(at).match(UUID_RE) ?? []).map(s => s.toLowerCase())));
}

export const MCP_REPLY_TIMEOUT = 45;   // сколько ждать ответа, с
const LOOKBACK = 300;                  // ответ мог прийти раньше, чем мы начали читать, — смотрим на 5 мин назад

/** Python-код для ядра скрипта: читает mcp-out и печатает ответы маркером @@ST_MSG. */
export function mcpReplyCode(ids: string[], timeout = MCP_REPLY_TIMEOUT): string {
  return `
def __st_mcp_reply(ids, timeout=${timeout}, lookback=${LOOKBACK}):
    import json as _json, time as _time
    from kafka import KafkaConsumer as _KC, TopicPartition as _TP
    g = globals()
    # Подключение — как у скрипта: настройки его producer, иначе BROKERS (PLAINTEXT).
    allowed = {"bootstrap_servers", "security_protocol", "ssl_context", "ssl_check_hostname", "ssl_cafile",
               "ssl_certfile", "ssl_keyfile", "ssl_password", "ssl_crlfile", "ssl_ciphers", "sasl_mechanism",
               "sasl_plain_username", "sasl_plain_password", "sasl_kerberos_service_name",
               "sasl_kerberos_domain_name", "api_version"}
    cfg = {}
    prod = g.get("producer")
    if prod is not None and isinstance(getattr(prod, "config", None), dict):
        cfg = {k: v for k, v in prod.config.items() if k in allowed and v is not None}
    if not cfg.get("bootstrap_servers"):
        if not g.get("BROKERS"):
            print("⚠️ Не нашёл настройки Kafka скрипта (producer / BROKERS) — ответ из mcp-out не прочитать")
            return
        cfg = {"bootstrap_servers": g["BROKERS"], "security_protocol": g.get("SECURITY_PROTOCOL", "PLAINTEXT")}
    topic = g.get("MCP_OUT_TOPIC", "mcp-out")
    wanted = {i.lower() for i in ids}
    found = set()
    c = _KC(enable_auto_commit=False, group_id=None, consumer_timeout_ms=1000, **cfg)
    try:
        parts = c.partitions_for_topic(topic) or set()
        if not parts:
            print(f"⚠️ Топик {topic} не найден на брокерах {cfg.get('bootstrap_servers')}")
            return
        tps = [_TP(topic, p) for p in parts]
        c.assign(tps)
        since = int((_time.time() - lookback) * 1000)
        offs = c.offsets_for_times({tp: since for tp in tps})
        ends = c.end_offsets(tps)
        for tp in tps:
            o = offs.get(tp)
            c.seek(tp, o.offset if o is not None else ends[tp])
        deadline = _time.time() + timeout
        while _time.time() < deadline and found != wanted:
            for tp, recs in c.poll(timeout_ms=1000).items():
                for r in recs:
                    key = r.key.decode("utf-8", "replace") if r.key else ""
                    raw = r.value.decode("utf-8", "replace") if r.value else ""
                    try:
                        body = _json.loads(raw)
                    except Exception:
                        body = raw
                    rid = str(body.get("id", "")).lower() if isinstance(body, dict) else ""
                    hit = next((i for i in wanted - found if i in (key.lower(), rid) or i in raw.lower()), None)
                    if not hit:
                        continue
                    found.add(hit)
                    headers = {k: (v.decode("utf-8", "replace") if isinstance(v, bytes) else str(v)) for k, v in (r.headers or [])}
                    print("@@ST_MSG " + _json.dumps({"topic": topic, "body": body, "key": key, "headers": headers,
                                                      "partition": r.partition, "offset": r.offset}, ensure_ascii=False))
                    print(f"📥 Ответ из {topic} по id {hit} получен")
    finally:
        c.close()
    for i in sorted(wanted - found):
        print(f"⌛ Ответа в {topic} по id {i} нет за {timeout} с — проверьте позже в «Просмотре Kafka»")

__st_mcp_reply(${JSON.stringify(ids)})
`;
}
