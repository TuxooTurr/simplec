package ru.mobilefarm.service;

import org.springframework.data.jpa.repository.JpaRepository;
import ru.mobilefarm.model.Device;
import ru.mobilefarm.model.Device.DeviceStatus;
import ru.mobilefarm.model.Device.Platform;

import java.util.List;

public interface DeviceRepository extends JpaRepository<Device, String> {

    List<Device> findByPlatform(Platform platform);

    List<Device> findByStatus(DeviceStatus status);

    List<Device> findByPlatformAndStatus(Platform platform, DeviceStatus status);
}
