package ru.mobilefarm.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import ru.mobilefarm.model.Device;
import ru.mobilefarm.service.DeviceRepository;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AgentControllerTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private DeviceRepository deviceRepository;

    @BeforeEach
    void setUp() {
        deviceRepository.deleteAll();
    }

    @Test
    void registerNewDevice() throws Exception {
        mockMvc.perform(post("/api/v1/agents/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                    "udid": "new-pixel",
                                    "platform": "ANDROID",
                                    "model": "Pixel 8 Pro",
                                    "osVersion": "14.0",
                                    "appiumPort": 4723,
                                    "agentHost": "mac-mini-1"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("registered"))
                .andExpect(jsonPath("$.udid").value("new-pixel"));

        Device saved = deviceRepository.findById("new-pixel").orElseThrow();
        assertEquals(Device.Platform.ANDROID, saved.getPlatform());
        assertEquals("Pixel 8 Pro", saved.getModel());
        assertEquals(Device.DeviceStatus.AVAILABLE, saved.getStatus());
        assertEquals(4723, saved.getAppiumPort());
    }

    @Test
    void registerExistingDeviceUpdates() throws Exception {
        var device = new Device();
        device.setUdid("existing-dev");
        device.setPlatform(Device.Platform.ANDROID);
        device.setModel("Old Model");
        device.setStatus(Device.DeviceStatus.OFFLINE);
        deviceRepository.save(device);

        mockMvc.perform(post("/api/v1/agents/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                    "udid": "existing-dev",
                                    "platform": "ANDROID",
                                    "model": "New Model",
                                    "osVersion": "14.0",
                                    "appiumPort": 4724
                                }
                                """))
                .andExpect(status().isOk());

        Device updated = deviceRepository.findById("existing-dev").orElseThrow();
        assertEquals("New Model", updated.getModel());
        assertEquals(Device.DeviceStatus.AVAILABLE, updated.getStatus());
    }

    @Test
    void heartbeatUpdatesDevice() throws Exception {
        var device = new Device();
        device.setUdid("hb-device");
        device.setPlatform(Device.Platform.IOS);
        device.setStatus(Device.DeviceStatus.AVAILABLE);
        deviceRepository.save(device);

        mockMvc.perform(post("/api/v1/agents/heartbeat")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"udid": "hb-device", "battery": 85}
                                """))
                .andExpect(status().isOk());

        Device updated = deviceRepository.findById("hb-device").orElseThrow();
        assertEquals(85, updated.getBattery());
        assertNotNull(updated.getLastSeen());
    }

    @Test
    void heartbeatForUnknownDeviceIsNoop() throws Exception {
        mockMvc.perform(post("/api/v1/agents/heartbeat")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"udid": "unknown-dev", "battery": 50}
                                """))
                .andExpect(status().isOk());
    }

    @Test
    void registerIosDevice() throws Exception {
        mockMvc.perform(post("/api/v1/agents/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                    "udid": "iphone-uuid-001",
                                    "platform": "IOS",
                                    "model": "iPhone 15 Pro",
                                    "osVersion": "17.4",
                                    "appiumPort": 4730,
                                    "agentHost": "mac-mini-1"
                                }
                                """))
                .andExpect(status().isOk());

        Device saved = deviceRepository.findById("iphone-uuid-001").orElseThrow();
        assertEquals(Device.Platform.IOS, saved.getPlatform());
        assertEquals("iPhone 15 Pro", saved.getModel());
    }
}
