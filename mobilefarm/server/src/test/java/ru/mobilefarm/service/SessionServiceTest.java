package ru.mobilefarm.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import ru.mobilefarm.model.Device;
import ru.mobilefarm.model.Session;
import ru.mobilefarm.model.User;

import static org.junit.jupiter.api.Assertions.*;

@DataJpaTest
@ActiveProfiles("test")
@Import(SessionService.class)
class SessionServiceTest {

    @Autowired
    private SessionService sessionService;

    @Autowired
    private DeviceRepository deviceRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private SessionRepository sessionRepository;

    private Device device;
    private User user;

    @BeforeEach
    void setUp() {
        sessionRepository.deleteAll();
        deviceRepository.deleteAll();
        userRepository.deleteAll();

        device = new Device();
        device.setUdid("test-udid-001");
        device.setPlatform(Device.Platform.ANDROID);
        device.setModel("Pixel 7");
        device.setStatus(Device.DeviceStatus.AVAILABLE);
        deviceRepository.save(device);

        user = new User();
        user.setUsername("testuser");
        user.setPassword("hashed");
        user.setRole(User.Role.USER);
        userRepository.save(user);
    }

    @Test
    void lockAvailableDevice() {
        Session session = sessionService.lockDevice("test-udid-001", "testuser", Session.SessionType.MANUAL);

        assertNotNull(session.getId());
        assertEquals(Session.SessionStatus.ACTIVE, session.getStatus());

        Device updated = deviceRepository.findById("test-udid-001").orElseThrow();
        assertEquals(Device.DeviceStatus.BUSY, updated.getStatus());
    }

    @Test
    void lockBusyDeviceThrows() {
        sessionService.lockDevice("test-udid-001", "testuser", Session.SessionType.MANUAL);

        assertThrows(IllegalStateException.class, () ->
                sessionService.lockDevice("test-udid-001", "testuser", Session.SessionType.MANUAL));
    }

    @Test
    void lockNonExistentDeviceThrows() {
        assertThrows(IllegalArgumentException.class, () ->
                sessionService.lockDevice("no-such-device", "testuser", Session.SessionType.MANUAL));
    }

    @Test
    void lockByNonExistentUserThrows() {
        assertThrows(IllegalArgumentException.class, () ->
                sessionService.lockDevice("test-udid-001", "ghost", Session.SessionType.MANUAL));
    }

    @Test
    void unlockDeviceReleasesSession() {
        sessionService.lockDevice("test-udid-001", "testuser", Session.SessionType.AUTOMATION);
        sessionService.unlockDevice("test-udid-001");

        Device updated = deviceRepository.findById("test-udid-001").orElseThrow();
        assertEquals(Device.DeviceStatus.AVAILABLE, updated.getStatus());

        var sessions = sessionRepository.findByStatus(Session.SessionStatus.ACTIVE);
        assertTrue(sessions.isEmpty());
    }

    @Test
    void maxSessionsPerUserEnforced() {
        for (int i = 1; i <= 3; i++) {
            var d = new Device();
            d.setUdid("device-" + i);
            d.setPlatform(Device.Platform.ANDROID);
            d.setStatus(Device.DeviceStatus.AVAILABLE);
            deviceRepository.save(d);
            sessionService.lockDevice("device-" + i, "testuser", Session.SessionType.MANUAL);
        }

        var extra = new Device();
        extra.setUdid("device-4");
        extra.setPlatform(Device.Platform.ANDROID);
        extra.setStatus(Device.DeviceStatus.AVAILABLE);
        deviceRepository.save(extra);

        assertThrows(IllegalStateException.class, () ->
                sessionService.lockDevice("device-4", "testuser", Session.SessionType.MANUAL));
    }

    @Test
    void getActiveSessionsReturnsOnlyActive() {
        sessionService.lockDevice("test-udid-001", "testuser", Session.SessionType.MANUAL);

        var active = sessionService.getActiveSessions();
        assertEquals(1, active.size());

        sessionService.unlockDevice("test-udid-001");

        active = sessionService.getActiveSessions();
        assertTrue(active.isEmpty());
    }
}
