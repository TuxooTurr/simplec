package ru.mobilefarm.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import ru.mobilefarm.model.Device;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class DeviceInteractionService {

    private final DeviceRepository deviceRepository;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, String> activeSessions = new ConcurrentHashMap<>();
    private final Map<String, int[]> screenSizes = new ConcurrentHashMap<>();

    public DeviceInteractionService(DeviceRepository deviceRepository) {
        this.deviceRepository = deviceRepository;
    }

    public byte[] screenshot(String udid) {
        try {
            byte[] agentResult = tryScreenshotAgent(udid);
            if (agentResult != null) return agentResult;

            String sessionId = getOrCreateSession(udid);
            if (sessionId == null) return null;

            Device device = deviceRepository.findById(udid).orElse(null);
            if (device == null) return null;

            String base = appiumBase(device);
            var req = HttpRequest.newBuilder()
                    .uri(URI.create(base + "/session/" + sessionId + "/screenshot"))
                    .timeout(Duration.ofSeconds(8))
                    .GET().build();
            var resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonNode json = mapper.readTree(resp.body());
            String b64 = json.get("value").asText();
            return Base64.getDecoder().decode(b64);
        } catch (Exception e) {
            activeSessions.remove(udid);
            return null;
        }
    }

    private byte[] tryScreenshotAgent(String udid) {
        try {
            var req = HttpRequest.newBuilder()
                    .uri(URI.create("http://localhost:9100/screenshot/" + udid))
                    .timeout(Duration.ofSeconds(5))
                    .GET().build();
            var resp = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
            if (resp.statusCode() == 200 && resp.body().length > 100) {
                return resp.body();
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    public void tap(String udid, double xPct, double yPct) {
        int[] size = getScreenSize(udid);
        int x = (int) (xPct * size[0]);
        int y = (int) (yPct * size[1]);

        Device device = deviceRepository.findById(udid).orElse(null);
        if (device == null) return;

        if (device.getPlatform() == Device.Platform.ANDROID) {
            adbShell(udid, "input tap " + x + " " + y);
        } else {
            appiumAction(udid, """
                {"actions":[{"type":"pointer","id":"finger1","parameters":{"pointerType":"touch"},
                "actions":[
                    {"type":"pointerMove","duration":0,"x":%d,"y":%d},
                    {"type":"pointerDown","button":0},
                    {"type":"pause","duration":50},
                    {"type":"pointerUp","button":0}
                ]}]}""".formatted(x, y));
        }
    }

    public void swipe(String udid, double x1Pct, double y1Pct, double x2Pct, double y2Pct, int durationMs) {
        int[] size = getScreenSize(udid);
        int x1 = (int) (x1Pct * size[0]);
        int y1 = (int) (y1Pct * size[1]);
        int x2 = (int) (x2Pct * size[0]);
        int y2 = (int) (y2Pct * size[1]);

        Device device = deviceRepository.findById(udid).orElse(null);
        if (device == null) return;

        if (device.getPlatform() == Device.Platform.ANDROID) {
            adbShell(udid, "input swipe " + x1 + " " + y1 + " " + x2 + " " + y2 + " " + durationMs);
        } else {
            appiumAction(udid, """
                {"actions":[{"type":"pointer","id":"finger1","parameters":{"pointerType":"touch"},
                "actions":[
                    {"type":"pointerMove","duration":0,"x":%d,"y":%d},
                    {"type":"pointerDown","button":0},
                    {"type":"pointerMove","duration":%d,"x":%d,"y":%d},
                    {"type":"pointerUp","button":0}
                ]}]}""".formatted(x1, y1, durationMs, x2, y2));
        }
    }

    public void longPress(String udid, double xPct, double yPct, int durationMs) {
        int[] size = getScreenSize(udid);
        int x = (int) (xPct * size[0]);
        int y = (int) (yPct * size[1]);

        Device device = deviceRepository.findById(udid).orElse(null);
        if (device == null) return;

        if (device.getPlatform() == Device.Platform.ANDROID) {
            adbShell(udid, "input swipe " + x + " " + y + " " + x + " " + y + " " + durationMs);
        } else {
            appiumAction(udid, """
                {"actions":[{"type":"pointer","id":"finger1","parameters":{"pointerType":"touch"},
                "actions":[
                    {"type":"pointerMove","duration":0,"x":%d,"y":%d},
                    {"type":"pointerDown","button":0},
                    {"type":"pause","duration":%d},
                    {"type":"pointerUp","button":0}
                ]}]}""".formatted(x, y, durationMs));
        }
    }

    public void sendKeys(String udid, String text) {
        Device device = deviceRepository.findById(udid).orElse(null);
        if (device == null) return;

        if (device.getPlatform() == Device.Platform.ANDROID) {
            adbShell(udid, "input text '" + text.replace("'", "'\\''") + "'");
        } else {
            String sessionId = getOrCreateSession(udid);
            if (sessionId == null) return;
            String base = appiumBase(device);
            try {
                var req = HttpRequest.newBuilder()
                        .uri(URI.create(base + "/session/" + sessionId + "/keys"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(
                                "{\"value\":[\"" + text.replace("\"", "\\\"") + "\"]}"))
                        .build();
                http.send(req, HttpResponse.BodyHandlers.discarding());
            } catch (Exception ignored) {
            }
        }
    }

    public void pressButton(String udid, String button) {
        Device device = deviceRepository.findById(udid).orElse(null);
        if (device == null) return;

        if (device.getPlatform() == Device.Platform.ANDROID) {
            int keycode = switch (button) {
                case "home" -> 3;
                case "back" -> 4;
                case "recent" -> 187;
                case "power" -> 26;
                case "volumeUp" -> 24;
                case "volumeDown" -> 25;
                default -> -1;
            };
            if (keycode > 0) adbShell(udid, "input keyevent " + keycode);
        } else {
            String sessionId = getOrCreateSession(udid);
            if (sessionId == null) return;
            String base = appiumBase(device);
            String cmd = switch (button) {
                case "home" -> "homescreen";
                case "volumeUp" -> "volumeUp";
                case "volumeDown" -> "volumeDown";
                default -> null;
            };
            if (cmd == null) return;
            try {
                var req = HttpRequest.newBuilder()
                        .uri(URI.create(base + "/session/" + sessionId + "/wda/" + cmd))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.noBody())
                        .build();
                http.send(req, HttpResponse.BodyHandlers.discarding());
            } catch (Exception ignored) {
            }
        }
    }

    public void lock(String udid) {
        Device device = deviceRepository.findById(udid).orElse(null);
        if (device == null) return;
        if (device.getPlatform() == Device.Platform.ANDROID) {
            adbShell(udid, "input keyevent 26");
        } else {
            String sessionId = getOrCreateSession(udid);
            if (sessionId == null) return;
            try {
                var req = HttpRequest.newBuilder()
                        .uri(URI.create(appiumBase(device) + "/session/" + sessionId + "/wda/lock"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.noBody()).build();
                http.send(req, HttpResponse.BodyHandlers.discarding());
            } catch (Exception ignored) {
            }
        }
    }

    public void unlock(String udid) {
        Device device = deviceRepository.findById(udid).orElse(null);
        if (device == null) return;
        if (device.getPlatform() == Device.Platform.ANDROID) {
            adbShell(udid, "input keyevent 82");
        } else {
            String sessionId = getOrCreateSession(udid);
            if (sessionId == null) return;
            try {
                var req = HttpRequest.newBuilder()
                        .uri(URI.create(appiumBase(device) + "/session/" + sessionId + "/wda/unlock"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.noBody()).build();
                http.send(req, HttpResponse.BodyHandlers.discarding());
            } catch (Exception ignored) {
            }
        }
    }

    public void releaseSession(String udid) {
        String sessionId = activeSessions.remove(udid);
        if (sessionId == null) return;
        screenSizes.remove(udid);
        Device device = deviceRepository.findById(udid).orElse(null);
        if (device == null) return;
        try {
            var req = HttpRequest.newBuilder()
                    .uri(URI.create(appiumBase(device) + "/session/" + sessionId))
                    .DELETE().build();
            http.send(req, HttpResponse.BodyHandlers.discarding());
        } catch (Exception ignored) {
        }
    }

    private String getOrCreateSession(String udid) {
        String existing = activeSessions.get(udid);
        if (existing != null) {
            if (isSessionAlive(udid, existing)) return existing;
            activeSessions.remove(udid);
        }

        Device device = deviceRepository.findById(udid).orElse(null);
        if (device == null) return null;

        String caps = buildCaps(device);
        String base = appiumBase(device);

        try {
            var req = HttpRequest.newBuilder()
                    .uri(URI.create(base + "/session"))
                    .header("Content-Type", "application/json")
                    .timeout(Duration.ofSeconds(120))
                    .POST(HttpRequest.BodyPublishers.ofString(caps))
                    .build();
            var resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonNode json = mapper.readTree(resp.body());
            if (json.has("value") && json.get("value").has("sessionId")) {
                String sessionId = json.get("value").get("sessionId").asText();
                activeSessions.put(udid, sessionId);
                fetchScreenSize(udid, device, sessionId);
                return sessionId;
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private boolean isSessionAlive(String udid, String sessionId) {
        Device device = deviceRepository.findById(udid).orElse(null);
        if (device == null) return false;
        try {
            var req = HttpRequest.newBuilder()
                    .uri(URI.create(appiumBase(device) + "/session/" + sessionId))
                    .timeout(Duration.ofSeconds(3))
                    .GET().build();
            var resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            return resp.statusCode() == 200;
        } catch (Exception e) {
            return false;
        }
    }

    private void fetchScreenSize(String udid, Device device, String sessionId) {
        try {
            var req = HttpRequest.newBuilder()
                    .uri(URI.create(appiumBase(device) + "/session/" + sessionId + "/window/current/size"))
                    .timeout(Duration.ofSeconds(5))
                    .GET().build();
            var resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonNode json = mapper.readTree(resp.body());
            int w = json.get("value").get("width").asInt();
            int h = json.get("value").get("height").asInt();
            screenSizes.put(udid, new int[]{w, h});
        } catch (Exception ignored) {
            screenSizes.put(udid, new int[]{390, 844});
        }
    }

    private int[] getScreenSize(String udid) {
        return screenSizes.getOrDefault(udid, new int[]{390, 844});
    }

    private String appiumBase(Device device) {
        String host = device.getAgentHost();
        if (host == null || host.isEmpty()) host = "localhost";
        int port = device.getAppiumPort() != null ? device.getAppiumPort() : 4723;
        return "http://" + host + ":" + port;
    }

    private void appiumAction(String udid, String actionsJson) {
        String sessionId = getOrCreateSession(udid);
        if (sessionId == null) return;
        Device device = deviceRepository.findById(udid).orElse(null);
        if (device == null) return;
        try {
            var req = HttpRequest.newBuilder()
                    .uri(URI.create(appiumBase(device) + "/session/" + sessionId + "/actions"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(actionsJson))
                    .build();
            http.send(req, HttpResponse.BodyHandlers.discarding());
        } catch (Exception ignored) {
        }
    }

    private void adbShell(String udid, String command) {
        try {
            new ProcessBuilder("adb", "-s", udid, "shell", command)
                    .redirectErrorStream(true)
                    .start()
                    .waitFor(5, java.util.concurrent.TimeUnit.SECONDS);
        } catch (Exception ignored) {
        }
    }

    private String buildCaps(Device device) {
        if (device.getPlatform() == Device.Platform.IOS) {
            return """
                {"capabilities":{"alwaysMatch":{
                    "platformName":"iOS",
                    "appium:udid":"%s",
                    "appium:automationName":"XCUITest",
                    "appium:noReset":true,
                    "appium:wdaLaunchTimeout":120000,
                    "appium:xcodeOrgId":"55L6G4CADB",
                    "appium:xcodeSigningId":"Apple Development",
                    "appium:updatedWDABundleId":"com.mobilefarm.WebDriverAgentRunner.xctrunner"
                }}}""".formatted(device.getUdid()).trim();
        }
        return """
            {"capabilities":{"alwaysMatch":{
                "platformName":"Android",
                "appium:udid":"%s",
                "appium:automationName":"UiAutomator2",
                "appium:noReset":true
            }}}""".formatted(device.getUdid()).trim();
    }
}
