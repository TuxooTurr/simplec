package ru.mobilefarm.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import ru.mobilefarm.model.Device;
import ru.mobilefarm.model.User;
import ru.mobilefarm.service.DeviceRepository;
import ru.mobilefarm.service.JwtService;
import ru.mobilefarm.service.SessionRepository;
import ru.mobilefarm.service.UserRepository;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DeviceControllerTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private DeviceRepository deviceRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private SessionRepository sessionRepository;
    @Autowired private PasswordEncoder passwordEncoder;
    @Autowired private JwtService jwtService;

    private String token;

    @BeforeEach
    void setUp() {
        sessionRepository.deleteAll();
        deviceRepository.deleteAll();
        userRepository.deleteAll();

        var user = new User();
        user.setUsername("tester");
        user.setPassword(passwordEncoder.encode("pass"));
        user.setRole(User.Role.USER);
        userRepository.save(user);

        token = jwtService.generateToken(user);

        var device = new Device();
        device.setUdid("dev-001");
        device.setPlatform(Device.Platform.ANDROID);
        device.setModel("Pixel 7");
        device.setStatus(Device.DeviceStatus.AVAILABLE);
        deviceRepository.save(device);
    }

    @Test
    void listDevicesRequiresAuth() throws Exception {
        mockMvc.perform(get("/api/v1/devices"))
                .andExpect(status().isForbidden());
    }

    @Test
    void listDevicesWithToken() throws Exception {
        mockMvc.perform(get("/api/v1/devices")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].udid").value("dev-001"))
                .andExpect(jsonPath("$[0].model").value("Pixel 7"));
    }

    @Test
    void getDeviceByUdid() throws Exception {
        mockMvc.perform(get("/api/v1/devices/dev-001")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.platform").value("ANDROID"));
    }

    @Test
    void getDeviceNotFound() throws Exception {
        mockMvc.perform(get("/api/v1/devices/no-such")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
    }

    @Test
    void lockAndUnlockDevice() throws Exception {
        mockMvc.perform(post("/api/v1/devices/dev-001/lock")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessionId").isNotEmpty())
                .andExpect(jsonPath("$.status").value("locked"));

        mockMvc.perform(post("/api/v1/devices/dev-001/unlock")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("unlocked"));
    }

    @Test
    void lockAlreadyLockedDevice() throws Exception {
        mockMvc.perform(post("/api/v1/devices/dev-001/lock")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/devices/dev-001/lock")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").exists());
    }

    @Test
    void filterDevicesByPlatform() throws Exception {
        var ios = new Device();
        ios.setUdid("iphone-001");
        ios.setPlatform(Device.Platform.IOS);
        ios.setModel("iPhone 15");
        ios.setStatus(Device.DeviceStatus.AVAILABLE);
        deviceRepository.save(ios);

        mockMvc.perform(get("/api/v1/devices?platform=ANDROID")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].platform").value("ANDROID"));
    }
}
