package ru.mobilefarm.device;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import ru.mobilefarm.service.DeviceInteractionService;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.*;

@Component
public class ScreenStreamHandler extends TextWebSocketHandler {

    private final Map<String, Set<WebSocketSession>> udidToSessions = new ConcurrentHashMap<>();
    private final Map<String, ScheduledFuture<?>> streamTasks = new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(4);
    private final ObjectMapper mapper = new ObjectMapper();
    private final DeviceInteractionService interactionService;

    public ScreenStreamHandler(DeviceInteractionService interactionService) {
        this.interactionService = interactionService;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String udid = extractUdid(session);
        udidToSessions.computeIfAbsent(udid, k -> new CopyOnWriteArraySet<>()).add(session);
        startStreamIfNeeded(udid);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String udid = extractUdid(session);
        var sessions = udidToSessions.get(udid);
        if (sessions != null) {
            sessions.remove(session);
            if (sessions.isEmpty()) {
                udidToSessions.remove(udid);
                stopStream(udid);
            }
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String udid = extractUdid(session);
        JsonNode cmd = mapper.readTree(message.getPayload());
        String type = cmd.has("type") ? cmd.get("type").asText() : "";

        switch (type) {
            case "tap" -> interactionService.tap(udid,
                    cmd.get("x").asDouble(), cmd.get("y").asDouble());
            case "swipe" -> interactionService.swipe(udid,
                    cmd.get("x1").asDouble(), cmd.get("y1").asDouble(),
                    cmd.get("x2").asDouble(), cmd.get("y2").asDouble(),
                    cmd.has("duration") ? cmd.get("duration").asInt() : 300);
            case "longpress" -> interactionService.longPress(udid,
                    cmd.get("x").asDouble(), cmd.get("y").asDouble(),
                    cmd.has("duration") ? cmd.get("duration").asInt() : 1000);
            case "text" -> interactionService.sendKeys(udid, cmd.get("value").asText());
            case "key" -> interactionService.pressButton(udid, cmd.get("name").asText());
            case "home" -> interactionService.pressButton(udid, "home");
            case "back" -> interactionService.pressButton(udid, "back");
            case "lock" -> interactionService.lock(udid);
            case "unlock" -> interactionService.unlock(udid);
        }
    }

    private void startStreamIfNeeded(String udid) {
        streamTasks.computeIfAbsent(udid, u ->
                scheduler.scheduleAtFixedRate(() -> captureAndPush(u), 0, 200, TimeUnit.MILLISECONDS));
    }

    private void stopStream(String udid) {
        var task = streamTasks.remove(udid);
        if (task != null) task.cancel(false);
        interactionService.releaseSession(udid);
    }

    private void captureAndPush(String udid) {
        var sessions = udidToSessions.get(udid);
        if (sessions == null || sessions.isEmpty()) return;

        try {
            byte[] frame = interactionService.screenshot(udid);
            if (frame == null || frame.length < 100) return;
            var msg = new BinaryMessage(frame);
            for (var s : sessions) {
                if (s.isOpen()) {
                    try {
                        s.sendMessage(msg);
                    } catch (IOException ignored) {
                        sessions.remove(s);
                    }
                }
            }
        } catch (Exception ignored) {
        }
    }

    public void pushFrame(String udid, byte[] jpegFrame) {
        var sessions = udidToSessions.get(udid);
        if (sessions == null) return;
        var message = new BinaryMessage(jpegFrame);
        for (var session : sessions) {
            if (session.isOpen()) {
                try {
                    session.sendMessage(message);
                } catch (Exception ignored) {
                    sessions.remove(session);
                }
            }
        }
    }

    private String extractUdid(WebSocketSession session) {
        String path = session.getUri().getPath();
        return path.substring(path.lastIndexOf('/') + 1);
    }
}
