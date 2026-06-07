package ru.mobilefarm.service;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import ru.mobilefarm.device.DeviceStatusHandler;
import ru.mobilefarm.model.Device;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

@Service
public class DeviceHealthMonitor {

    private final DeviceRepository deviceRepository;
    private final DeviceStatusHandler statusHandler;

    public DeviceHealthMonitor(DeviceRepository deviceRepository, DeviceStatusHandler statusHandler) {
        this.deviceRepository = deviceRepository;
        this.statusHandler = statusHandler;
    }

    @Scheduled(fixedRate = 30_000)
    public void markStaleDevicesOffline() {
        var threshold = Instant.now().minus(60, ChronoUnit.SECONDS);
        var devices = deviceRepository.findAll();
        for (var device : devices) {
            if (device.getStatus() != Device.DeviceStatus.OFFLINE
                    && device.getLastSeen() != null
                    && device.getLastSeen().isBefore(threshold)) {
                device.setStatus(Device.DeviceStatus.OFFLINE);
                deviceRepository.save(device);
                broadcastStatus(device);
            }
        }
    }

    private void broadcastStatus(Device device) {
        String json = """
                {"type":"device_status","udid":"%s","platform":"%s","model":"%s","osVersion":"%s","status":"OFFLINE","battery":%s,"lockedBy":null}
                """.formatted(
                device.getUdid(), device.getPlatform(), device.getModel(),
                device.getOsVersion(),
                device.getBattery() != null ? device.getBattery() : "null"
        ).trim();
        statusHandler.broadcast(json);
    }
}
