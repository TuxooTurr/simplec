package ru.mobilefarm.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import ru.mobilefarm.model.Device;
import ru.mobilefarm.model.Session;
import ru.mobilefarm.service.DeviceService;
import ru.mobilefarm.service.SessionService;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/devices")
public class DeviceController {

    private final DeviceService deviceService;
    private final SessionService sessionService;

    public DeviceController(DeviceService deviceService, SessionService sessionService) {
        this.deviceService = deviceService;
        this.sessionService = sessionService;
    }

    @GetMapping
    public List<Device> listDevices(
            @RequestParam(required = false) Device.Platform platform,
            @RequestParam(required = false) Device.DeviceStatus status) {
        return deviceService.listDevices(platform, status);
    }

    @GetMapping("/{udid}")
    public ResponseEntity<Device> getDevice(@PathVariable String udid) {
        return deviceService.findByUdid(udid)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{udid}/lock")
    public ResponseEntity<?> lockDevice(@PathVariable String udid, Authentication auth) {
        try {
            var session = sessionService.lockDevice(udid, auth.getName(), Session.SessionType.MANUAL);
            return ResponseEntity.ok(Map.of(
                    "sessionId", session.getId(),
                    "udid", udid,
                    "status", "locked"
            ));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(409).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{udid}/unlock")
    public ResponseEntity<?> unlockDevice(@PathVariable String udid, Authentication auth) {
        sessionService.unlockDevice(udid);
        return ResponseEntity.ok(Map.of("udid", udid, "status", "unlocked"));
    }

    @PostMapping("/{udid}/install")
    public ResponseEntity<?> installApp(@PathVariable String udid) {
        return ResponseEntity.ok(Map.of("status", "not_implemented"));
    }

    @GetMapping("/{udid}/screenshot")
    public ResponseEntity<byte[]> screenshot(@PathVariable String udid) {
        byte[] image = deviceService.takeScreenshot(udid);
        return ResponseEntity.ok()
                .header("Content-Type", "image/png")
                .body(image);
    }

    @GetMapping("/{udid}/logs")
    public ResponseEntity<?> deviceLogs(@PathVariable String udid,
                                         @RequestParam(defaultValue = "100") int lines) {
        return ResponseEntity.ok(Map.of("status", "not_implemented"));
    }
}
