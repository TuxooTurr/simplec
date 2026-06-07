package ru.mobilefarm.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.mobilefarm.model.Device;
import ru.mobilefarm.model.Session;
import ru.mobilefarm.model.User;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

@Service
public class SessionService {

    private final SessionRepository sessionRepository;
    private final DeviceRepository deviceRepository;
    private final UserRepository userRepository;

    @Value("${farm.session.max-sessions-per-user:3}")
    private int maxSessionsPerUser;

    public SessionService(SessionRepository sessionRepository,
                          DeviceRepository deviceRepository,
                          UserRepository userRepository) {
        this.sessionRepository = sessionRepository;
        this.deviceRepository = deviceRepository;
        this.userRepository = userRepository;
    }

    @Transactional
    public Session lockDevice(String udid, String username, Session.SessionType type) {
        Device device = deviceRepository.findById(udid)
                .orElseThrow(() -> new IllegalArgumentException("Device not found: " + udid));

        if (device.getStatus() != Device.DeviceStatus.AVAILABLE) {
            throw new IllegalStateException("Device is not available");
        }

        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new IllegalArgumentException("User not found: " + username));

        long active = sessionRepository.countByUserIdAndStatus(user.getId(), Session.SessionStatus.ACTIVE);
        if (active >= maxSessionsPerUser) {
            throw new IllegalStateException("Max concurrent sessions reached: " + maxSessionsPerUser);
        }

        device.setStatus(Device.DeviceStatus.BUSY);
        deviceRepository.save(device);

        var session = new Session();
        session.setDevice(device);
        session.setUser(user);
        session.setType(type);
        return sessionRepository.save(session);
    }

    @Transactional
    public void unlockDevice(String udid) {
        sessionRepository.findByDeviceUdidAndStatus(udid, Session.SessionStatus.ACTIVE)
                .ifPresent(session -> {
                    session.setStatus(Session.SessionStatus.COMPLETED);
                    session.setEndedAt(Instant.now());
                    sessionRepository.save(session);
                });

        deviceRepository.findById(udid).ifPresent(device -> {
            device.setStatus(Device.DeviceStatus.AVAILABLE);
            deviceRepository.save(device);
        });
    }

    public List<Session> getActiveSessions() {
        return sessionRepository.findByStatus(Session.SessionStatus.ACTIVE);
    }

    public List<Session> getAllSessions() {
        return sessionRepository.findAll();
    }

    @Transactional
    public void forceRelease(UUID sessionId) {
        Session session = sessionRepository.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionId));

        if (session.getStatus() != Session.SessionStatus.ACTIVE) {
            throw new IllegalStateException("Session is not active");
        }

        session.setStatus(Session.SessionStatus.FORCE_RELEASED);
        session.setEndedAt(Instant.now());
        sessionRepository.save(session);

        var device = session.getDevice();
        device.setStatus(Device.DeviceStatus.AVAILABLE);
        deviceRepository.save(device);
    }

    @Scheduled(fixedDelayString = "${farm.agent.health-check-interval-sec:10}000")
    @Transactional
    public void expireTimedOutSessions() {
        var activeSessions = sessionRepository.findByStatus(Session.SessionStatus.ACTIVE);
        var now = Instant.now();
        for (var session : activeSessions) {
            var deadline = session.getStartedAt().plus(session.getTimeoutMin(), ChronoUnit.MINUTES);
            if (now.isAfter(deadline)) {
                session.setStatus(Session.SessionStatus.TIMED_OUT);
                session.setEndedAt(now);
                sessionRepository.save(session);

                var device = session.getDevice();
                device.setStatus(Device.DeviceStatus.AVAILABLE);
                deviceRepository.save(device);
            }
        }
    }
}
