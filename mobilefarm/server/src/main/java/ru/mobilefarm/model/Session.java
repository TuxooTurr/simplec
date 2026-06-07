package ru.mobilefarm.model;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "sessions")
public class Session {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "device_udid", nullable = false)
    private Device device;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private SessionType type;

    private Instant startedAt = Instant.now();
    private Instant endedAt;
    private int timeoutMin = 30;

    @Enumerated(EnumType.STRING)
    private SessionStatus status = SessionStatus.ACTIVE;

    public enum SessionType { MANUAL, AUTOMATION }

    public enum SessionStatus { ACTIVE, COMPLETED, TIMED_OUT, FORCE_RELEASED }

    public UUID getId() { return id; }

    public Device getDevice() { return device; }
    public void setDevice(Device device) { this.device = device; }

    public User getUser() { return user; }
    public void setUser(User user) { this.user = user; }

    public SessionType getType() { return type; }
    public void setType(SessionType type) { this.type = type; }

    public Instant getStartedAt() { return startedAt; }
    public Instant getEndedAt() { return endedAt; }
    public void setEndedAt(Instant endedAt) { this.endedAt = endedAt; }

    public int getTimeoutMin() { return timeoutMin; }
    public void setTimeoutMin(int timeoutMin) { this.timeoutMin = timeoutMin; }

    public SessionStatus getStatus() { return status; }
    public void setStatus(SessionStatus status) { this.status = status; }
}
