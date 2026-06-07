package ru.mobilefarm.service;

import org.springframework.data.jpa.repository.JpaRepository;
import ru.mobilefarm.model.Session;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SessionRepository extends JpaRepository<Session, UUID> {

    List<Session> findByStatus(Session.SessionStatus status);

    List<Session> findByUserIdOrderByStartedAtDesc(UUID userId);

    Optional<Session> findByDeviceUdidAndStatus(String deviceUdid, Session.SessionStatus status);

    long countByUserIdAndStatus(UUID userId, Session.SessionStatus status);
}
