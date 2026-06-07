package ru.mobilefarm.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import ru.mobilefarm.model.Device;

import static org.junit.jupiter.api.Assertions.*;

@DataJpaTest
@ActiveProfiles("test")
@Import(DeviceService.class)
class DeviceServiceTest {

    @Autowired
    private DeviceService deviceService;

    @Autowired
    private DeviceRepository deviceRepository;

    @BeforeEach
    void setUp() {
        deviceRepository.deleteAll();
        saveDevice("pixel-001", Device.Platform.ANDROID, Device.DeviceStatus.AVAILABLE, "Pixel 7");
        saveDevice("iphone-001", Device.Platform.IOS, Device.DeviceStatus.AVAILABLE, "iPhone 15");
        saveDevice("pixel-002", Device.Platform.ANDROID, Device.DeviceStatus.OFFLINE, "Pixel 8");
    }

    @Test
    void listAllDevices() {
        var devices = deviceService.listDevices(null, null);
        assertEquals(3, devices.size());
    }

    @Test
    void filterByPlatform() {
        var android = deviceService.listDevices(Device.Platform.ANDROID, null);
        assertEquals(2, android.size());

        var ios = deviceService.listDevices(Device.Platform.IOS, null);
        assertEquals(1, ios.size());
    }

    @Test
    void filterByStatus() {
        var available = deviceService.listDevices(null, Device.DeviceStatus.AVAILABLE);
        assertEquals(2, available.size());

        var offline = deviceService.listDevices(null, Device.DeviceStatus.OFFLINE);
        assertEquals(1, offline.size());
    }

    @Test
    void filterByPlatformAndStatus() {
        var result = deviceService.listDevices(Device.Platform.ANDROID, Device.DeviceStatus.AVAILABLE);
        assertEquals(1, result.size());
        assertEquals("Pixel 7", result.getFirst().getModel());
    }

    @Test
    void findByUdid() {
        var device = deviceService.findByUdid("pixel-001");
        assertTrue(device.isPresent());
        assertEquals("Pixel 7", device.get().getModel());
    }

    @Test
    void findByUdidNotFound() {
        var device = deviceService.findByUdid("non-existent");
        assertTrue(device.isEmpty());
    }

    @Test
    void lockAvailableDevice() {
        deviceService.lockDevice("pixel-001");
        var device = deviceRepository.findById("pixel-001").orElseThrow();
        assertEquals(Device.DeviceStatus.BUSY, device.getStatus());
    }

    @Test
    void lockNonAvailableDeviceThrows() {
        assertThrows(IllegalStateException.class, () -> deviceService.lockDevice("pixel-002"));
    }

    @Test
    void unlockDevice() {
        deviceService.lockDevice("pixel-001");
        deviceService.unlockDevice("pixel-001");
        var device = deviceRepository.findById("pixel-001").orElseThrow();
        assertEquals(Device.DeviceStatus.AVAILABLE, device.getStatus());
    }

    private void saveDevice(String udid, Device.Platform platform, Device.DeviceStatus status, String model) {
        var device = new Device();
        device.setUdid(udid);
        device.setPlatform(platform);
        device.setStatus(status);
        device.setModel(model);
        deviceRepository.save(device);
    }
}
