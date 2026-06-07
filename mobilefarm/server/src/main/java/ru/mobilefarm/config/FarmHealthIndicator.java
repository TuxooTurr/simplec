package ru.mobilefarm.config;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;
import ru.mobilefarm.model.Device;
import ru.mobilefarm.service.DeviceRepository;

@Component
public class FarmHealthIndicator implements HealthIndicator {

    private final DeviceRepository deviceRepository;

    public FarmHealthIndicator(DeviceRepository deviceRepository) {
        this.deviceRepository = deviceRepository;
    }

    @Override
    public Health health() {
        long total = deviceRepository.count();
        long available = deviceRepository.findByStatus(Device.DeviceStatus.AVAILABLE).size();
        long busy = deviceRepository.findByStatus(Device.DeviceStatus.BUSY).size();
        long offline = deviceRepository.findByStatus(Device.DeviceStatus.OFFLINE).size();

        return Health.up()
                .withDetail("devices.total", total)
                .withDetail("devices.available", available)
                .withDetail("devices.busy", busy)
                .withDetail("devices.offline", offline)
                .build();
    }
}
