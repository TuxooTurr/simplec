package ru.mobilefarm.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import ru.mobilefarm.model.Session;
import ru.mobilefarm.service.SessionService;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/sessions")
public class SessionController {

    private final SessionService sessionService;

    public SessionController(SessionService sessionService) {
        this.sessionService = sessionService;
    }

    @GetMapping
    public List<Session> listSessions() {
        return sessionService.getAllSessions();
    }

    @GetMapping("/active")
    public List<Session> activeSessions() {
        return sessionService.getActiveSessions();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> forceRelease(@PathVariable UUID id) {
        sessionService.forceRelease(id);
        return ResponseEntity.ok(java.util.Map.of("status", "released", "sessionId", id));
    }
}
