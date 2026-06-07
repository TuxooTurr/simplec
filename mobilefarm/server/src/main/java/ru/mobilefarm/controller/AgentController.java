package ru.mobilefarm.controller;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import ru.mobilefarm.device.DeviceStatusHandler;
import ru.mobilefarm.model.Device;
import ru.mobilefarm.service.DeviceRepository;

import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/agents")
public class AgentController {

    private final DeviceRepository deviceRepository;
    private final DeviceStatusHandler statusHandler;

    public AgentController(DeviceRepository deviceRepository, DeviceStatusHandler statusHandler) {
        this.deviceRepository = deviceRepository;
        this.statusHandler = statusHandler;
    }

    @PostMapping("/register")
    public ResponseEntity<?> registerDevice(@RequestBody JsonNode body) {
        String udid = body.get("udid").asText();
        String platform = body.get("platform").asText();

        Device device = deviceRepository.findById(udid).orElseGet(() -> {
            var d = new Device();
            d.setUdid(udid);
            return d;
        });

        device.setPlatform(Device.Platform.valueOf(platform));
        device.setModel(body.has("model") ? body.get("model").asText() : "Unknown");
        device.setOsVersion(body.has("osVersion") ? body.get("osVersion").asText() : "");
        device.setAgentHost(body.has("agentHost") ? body.get("agentHost").asText() : "");
        device.setAppiumPort(body.has("appiumPort") ? body.get("appiumPort").asInt() : null);
        device.setStatus(Device.DeviceStatus.AVAILABLE);
        device.setLastSeen(Instant.now());

        deviceRepository.save(device);

        broadcastStatus(device);

        return ResponseEntity.ok(Map.of("status", "registered", "udid", udid));
    }

    @PostMapping("/heartbeat")
    public ResponseEntity<?> heartbeat(@RequestBody JsonNode body) {
        String udid = body.get("udid").asText();
        deviceRepository.findById(udid).ifPresent(device -> {
            device.setLastSeen(Instant.now());
            if (body.has("battery")) device.setBattery(body.get("battery").asInt());
            deviceRepository.save(device);
            broadcastStatus(device);
        });
        return ResponseEntity.ok(Map.of("status", "ok"));
    }

    private void broadcastStatus(Device device) {
        String json = """
                {"type":"device_status","udid":"%s","platform":"%s","model":"%s","osVersion":"%s","status":"%s","battery":%s,"lockedBy":null}
                """.formatted(
                device.getUdid(), device.getPlatform(), device.getModel(),
                device.getOsVersion(), device.getStatus(),
                device.getBattery() != null ? device.getBattery() : "null"
        ).trim();
        statusHandler.broadcast(json);
    }
}
