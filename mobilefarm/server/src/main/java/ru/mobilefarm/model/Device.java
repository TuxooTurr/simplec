package ru.mobilefarm.model;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "devices")
public class Device {

    @Id
    private String udid;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Platform platform;

    private String model;
    private String osVersion;
    private String agentHost;
    private Integer appiumPort;

    @Enumerated(EnumType.STRING)
    private DeviceStatus status = DeviceStatus.OFFLINE;

    private Integer battery;
    private Instant lastSeen;

    public enum Platform { ANDROID, IOS }

    public enum DeviceStatus { AVAILABLE, BUSY, OFFLINE, MAINTENANCE }

    public String getUdid() { return udid; }
    public void setUdid(String udid) { this.udid = udid; }

    public Platform getPlatform() { return platform; }
    public void setPlatform(Platform platform) { this.platform = platform; }

    public String getModel() { return model; }
    public void setModel(String model) { this.model = model; }

    public String getOsVersion() { return osVersion; }
    public void setOsVersion(String osVersion) { this.osVersion = osVersion; }

    public String getAgentHost() { return agentHost; }
    public void setAgentHost(String agentHost) { this.agentHost = agentHost; }

    public Integer getAppiumPort() { return appiumPort; }
    public void setAppiumPort(Integer appiumPort) { this.appiumPort = appiumPort; }

    public DeviceStatus getStatus() { return status; }
    public void setStatus(DeviceStatus status) { this.status = status; }

    public Integer getBattery() { return battery; }
    public void setBattery(Integer battery) { this.battery = battery; }

    public Instant getLastSeen() { return lastSeen; }
    public void setLastSeen(Instant lastSeen) { this.lastSeen = lastSeen; }
}
