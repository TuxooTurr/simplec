"""
Mock-сервер логов для тестирования анализатора.
Эмулирует REST API с тестовыми ошибками микросервисов.

Запуск: python3 mock_logs_server.py
Порт: 9999
"""

import json
import random
import uuid
from datetime import datetime, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# ── Тестовые данные ──────────────────────────────────────────────────────────

SERVICES = [
    "auth-service",
    "payment-service",
    "notification-svc",
    "gateway-api",
    "user-profile",
    "order-service",
    "inventory-svc",
    "analytics-worker",
]

ERRORS = [
    {
        "service": "auth-service",
        "level": "ERROR",
        "message": "java.lang.NullPointerException: Cannot invoke method getEmail() on null reference",
        "stacktrace": """java.lang.NullPointerException: Cannot invoke method getEmail() on null reference
    at com.app.auth.service.UserService.getUserByEmail(UserService.java:142)
    at com.app.auth.controller.AuthController.login(AuthController.java:67)
    at sun.reflect.NativeMethodAccessorImpl.invoke0(Native Method)
    at org.springframework.web.servlet.FrameworkServlet.service(FrameworkServlet.java:897)
    at javax.servlet.http.HttpServlet.service(HttpServlet.java:750)
    at org.apache.catalina.core.ApplicationFilterChain.doFilter(ApplicationFilterChain.java:227)""",
        "metadata": {"pod_name": "auth-service-7f8b9c4d5-xk2lm", "namespace": "production", "trace_id": "abc123def456"},
    },
    {
        "service": "auth-service",
        "level": "ERROR",
        "message": "java.lang.NullPointerException: Cannot invoke method getEmail() on null reference",
        "stacktrace": """java.lang.NullPointerException: Cannot invoke method getEmail() on null reference
    at com.app.auth.service.UserService.getUserByEmail(UserService.java:142)
    at com.app.auth.controller.AuthController.login(AuthController.java:67)
    at sun.reflect.NativeMethodAccessorImpl.invoke0(Native Method)""",
        "metadata": {"pod_name": "auth-service-7f8b9c4d5-pk9nm", "namespace": "production", "trace_id": "abc123def789"},
    },
    {
        "service": "auth-service",
        "level": "ERROR",
        "message": "java.lang.NullPointerException: Cannot invoke method getEmail() on null reference",
        "stacktrace": """java.lang.NullPointerException: Cannot invoke method getEmail() on null reference
    at com.app.auth.service.UserService.getUserByEmail(UserService.java:142)
    at com.app.auth.controller.AuthController.login(AuthController.java:67)
    at sun.reflect.NativeMethodAccessorImpl.invoke0(Native Method)""",
        "metadata": {"pod_name": "auth-service-7f8b9c4d5-ab1cd", "namespace": "production", "trace_id": "abc123def999"},
    },
    {
        "service": "payment-service",
        "level": "ERROR",
        "message": "org.postgresql.util.PSQLException: Connection to localhost:5432 refused. Check that the hostname and port are correct.",
        "stacktrace": """org.postgresql.util.PSQLException: Connection to localhost:5432 refused.
    at org.postgresql.core.v3.ConnectionFactoryImpl.openConnectionImpl(ConnectionFactoryImpl.java:315)
    at org.postgresql.core.ConnectionFactory.openConnection(ConnectionFactory.java:49)
    at org.postgresql.jdbc.PgConnection.<init>(PgConnection.java:223)
    at com.app.payment.repository.PaymentRepository.findByOrderId(PaymentRepository.java:89)
    at com.app.payment.service.PaymentService.processPayment(PaymentService.java:156)
    at com.app.payment.controller.PaymentController.pay(PaymentController.java:43)""",
        "metadata": {"pod_name": "payment-svc-5c6d7e8f-mn3op", "namespace": "production", "trace_id": "pay-001-xyz"},
    },
    {
        "service": "notification-svc",
        "level": "WARN",
        "message": "Failed to send email notification: SMTP connection timeout after 30000ms",
        "stacktrace": """java.net.SocketTimeoutException: Connect timed out
    at java.net.PlainSocketImpl.socketConnect(Native Method)
    at com.app.notification.email.SmtpClient.connect(SmtpClient.java:78)
    at com.app.notification.service.EmailNotificationService.send(EmailNotificationService.java:45)
    at com.app.notification.handler.OrderEventHandler.onOrderCompleted(OrderEventHandler.java:32)""",
        "metadata": {"pod_name": "notif-svc-3a4b5c6d-qr7st", "namespace": "production"},
    },
    {
        "service": "gateway-api",
        "level": "ERROR",
        "message": "io.netty.handler.timeout.ReadTimeoutException: null",
        "stacktrace": """io.netty.handler.timeout.ReadTimeoutException
    at io.netty.handler.timeout.ReadTimeoutHandler.readTimedOut(ReadTimeoutHandler.java:98)
    at io.netty.handler.timeout.ReadTimeoutHandler.channelIdle(ReadTimeoutHandler.java:90)
    at io.netty.handler.timeout.IdleStateHandler$ReaderIdleTimeoutTask.run(IdleStateHandler.java:505)
    at org.springframework.cloud.gateway.filter.NettyRoutingFilter.filter(NettyRoutingFilter.java:108)""",
        "metadata": {"pod_name": "gateway-api-9x8w7v6u-lk5mj", "namespace": "production", "trace_id": "gw-timeout-001"},
    },
    {
        "service": "order-service",
        "level": "ERROR",
        "message": "com.fasterxml.jackson.databind.exc.InvalidDefinitionException: Cannot construct instance of OrderDTO: no suitable constructor found",
        "stacktrace": """com.fasterxml.jackson.databind.exc.InvalidDefinitionException: Cannot construct instance of `com.app.order.dto.OrderDTO`
    at com.fasterxml.jackson.databind.exc.InvalidDefinitionException.from(InvalidDefinitionException.java:67)
    at com.fasterxml.jackson.databind.DeserializationContext.reportBadDefinition(DeserializationContext.java:1764)
    at com.fasterxml.jackson.databind.deser.BeanDeserializerBase.deserializeFromObjectUsingNonDefault(BeanDeserializerBase.java:1393)
    at com.app.order.controller.OrderController.createOrder(OrderController.java:58)""",
        "metadata": {"pod_name": "order-svc-2b3c4d5e-fg6hi", "namespace": "production", "trace_id": "ord-ser-042"},
    },
    {
        "service": "user-profile",
        "level": "ERROR",
        "message": "redis.clients.jedis.exceptions.JedisConnectionException: Could not get a resource from the pool",
        "stacktrace": """redis.clients.jedis.exceptions.JedisConnectionException: Could not get a resource from the pool
    at redis.clients.jedis.JedisPool.getResource(JedisPool.java:254)
    at com.app.profile.cache.UserCacheService.get(UserCacheService.java:34)
    at com.app.profile.service.ProfileService.getProfile(ProfileService.java:67)
    at com.app.profile.controller.ProfileController.getMe(ProfileController.java:29)
Caused by: redis.clients.jedis.exceptions.JedisExhaustedPoolException: Pool exhausted
    at org.apache.commons.pool2.impl.GenericObjectPool.borrowObject(GenericObjectPool.java:462)""",
        "metadata": {"pod_name": "user-profile-1a2b3c4d-uv5wx", "namespace": "production"},
    },
    {
        "service": "inventory-svc",
        "level": "WARN",
        "message": "Stock level critically low for SKU-78432: remaining=2, threshold=10",
        "stacktrace": "",
        "metadata": {"pod_name": "inventory-svc-6e7f8g9h-yz0ab", "namespace": "production", "sku": "SKU-78432"},
    },
    {
        "service": "analytics-worker",
        "level": "ERROR",
        "message": "java.lang.OutOfMemoryError: Java heap space",
        "stacktrace": """java.lang.OutOfMemoryError: Java heap space
    at java.util.Arrays.copyOf(Arrays.java:3236)
    at java.util.ArrayList.grow(ArrayList.java:265)
    at com.app.analytics.aggregator.MetricsAggregator.aggregate(MetricsAggregator.java:189)
    at com.app.analytics.worker.AnalyticsJob.execute(AnalyticsJob.java:72)
    at org.quartz.core.JobRunShell.run(JobRunShell.java:202)
    at org.quartz.simpl.SimpleThreadPool$WorkerThread.run(SimpleThreadPool.java:573)""",
        "metadata": {"pod_name": "analytics-worker-4c5d6e7f-cd8ef", "namespace": "production", "heap_max": "512m"},
    },
]


def generate_logs(services_filter=None, level_filter="ERROR", query="", limit=100):
    """Генерация тестовых логов."""
    now = datetime.utcnow()
    result = []

    candidates = ERRORS.copy()

    # Фильтр по сервисам
    if services_filter:
        svc_list = [s.strip() for s in services_filter.split(",")]
        candidates = [e for e in candidates if e["service"] in svc_list]

    # Фильтр по уровню
    level_upper = level_filter.upper()
    if level_upper == "ERROR":
        candidates = [e for e in candidates if e["level"] == "ERROR"]
    elif level_upper == "WARN":
        candidates = [e for e in candidates if e["level"] == "WARN"]
    elif level_upper == "FATAL":
        candidates = [e for e in candidates if e["level"] == "FATAL"]
    elif level_upper == "ERROR+WARN":
        candidates = [e for e in candidates if e["level"] in ("ERROR", "WARN")]

    # Текстовый фильтр
    if query:
        q = query.lower()
        candidates = [e for e in candidates if q in e["message"].lower() or q in e.get("stacktrace", "").lower()]

    if not candidates:
        return {"items": [], "total": 0}

    for i in range(min(limit, len(candidates) * 3)):
        error = candidates[i % len(candidates)]
        ts = now - timedelta(minutes=random.randint(1, 120), seconds=random.randint(0, 59))
        result.append({
            "id": str(uuid.uuid4()),
            "timestamp": ts.isoformat() + "Z",
            "service": error["service"],
            "level": error["level"],
            "message": error["message"],
            "stacktrace": error["stacktrace"],
            "metadata": error["metadata"],
        })

    result.sort(key=lambda x: x["timestamp"], reverse=True)
    return {"items": result[:limit], "total": len(result)}


class MockHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        params = parse_qs(parsed.query)

        if path == "/services":
            self._json_response(SERVICES)
        elif path == "/logs" or path == "":
            services_filter = params.get("services", [None])[0]
            level = params.get("level", ["ERROR"])[0]
            query = params.get("query", [""])[0]
            limit = int(params.get("limit", ["100"])[0])
            data = generate_logs(services_filter, level, query, limit)
            self._json_response(data)
        elif path == "/health":
            self._json_response({"status": "ok", "version": "1.0.0-mock"})
        else:
            self._json_response({"status": "ok", "name": "Mock Logs Server", "version": "1.0.0"})

    def _json_response(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"[MOCK LOGS] {args[0]}")


if __name__ == "__main__":
    port = 9999
    server = HTTPServer(("127.0.0.1", port), MockHandler)
    print(f"🔧 Mock Logs Server запущен на http://127.0.0.1:{port}")
    print(f"   GET /services    → список сервисов")
    print(f"   GET /logs        → тестовые ошибки")
    print(f"   GET /health      → health check")
    print()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n⏹  Остановлен")
        server.server_close()
