package ru.mobilefarm.service;

import org.springframework.stereotype.Service;
import ru.mobilefarm.model.Device;
import ru.mobilefarm.model.Device.DeviceStatus;
import ru.mobilefarm.model.Device.Platform;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Base64;
import java.util.List;
import java.util.Optional;

@Service
public class DeviceService {

    private final DeviceRepository deviceRepository;
    private final HttpClient http = HttpClient.newHttpClient();

    public DeviceService(DeviceRepository deviceRepository) {
        this.deviceRepository = deviceRepository;
    }

    public List<Device> listDevices(Platform platform, DeviceStatus status) {
        if (platform != null && status != null) {
            return deviceRepository.findByPlatformAndStatus(platform, status);
        } else if (platform != null) {
            return deviceRepository.findByPlatform(platform);
        } else if (status != null) {
            return deviceRepository.findByStatus(status);
        }
        return deviceRepository.findAll();
    }

    public Optional<Device> findByUdid(String udid) {
        return deviceRepository.findById(udid);
    }

    public void lockDevice(String udid) {
        Device device = deviceRepository.findById(udid)
                .orElseThrow(() -> new IllegalArgumentException("Device not found: " + udid));
        if (device.getStatus() != DeviceStatus.AVAILABLE) {
            throw new IllegalStateException("Device is not available: " + device.getStatus());
        }
        device.setStatus(DeviceStatus.BUSY);
        deviceRepository.save(device);
    }

    public void unlockDevice(String udid) {
        Device device = deviceRepository.findById(udid)
                .orElseThrow(() -> new IllegalArgumentException("Device not found: " + udid));
        device.setStatus(DeviceStatus.AVAILABLE);
        deviceRepository.save(device);
    }

    public byte[] takeScreenshot(String udid) {
        deviceRepository.findById(udid)
                .orElseThrow(() -> new IllegalArgumentException("Device not found: " + udid));

        byte[] result = tryScreenshotAgent(udid);
        if (result != null) return result;

        result = tryAdbScreenshot(udid);
        if (result != null) return result;

        throw new RuntimeException("Screenshot failed: no method available for " + udid);
    }

    private byte[] tryScreenshotAgent(String udid) {
        try {
            var req = HttpRequest.newBuilder()
                    .uri(URI.create("http://localhost:9100/screenshot/" + udid))
                    .timeout(java.time.Duration.ofSeconds(10))
                    .GET().build();
            var resp = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
            if (resp.statusCode() == 200 && resp.body().length > 100) {
                return resp.body();
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private byte[] tryAdbScreenshot(String udid) {
        try {
            var proc = new ProcessBuilder("adb", "-s", udid, "exec-out", "screencap", "-p")
                    .redirectErrorStream(false)
                    .start();
            byte[] data = proc.getInputStream().readAllBytes();
            proc.waitFor(10, java.util.concurrent.TimeUnit.SECONDS);
            if (proc.exitValue() == 0 && data.length > 100) {
                return data;
            }
        } catch (Exception ignored) {
        }
        return null;
    }
}
