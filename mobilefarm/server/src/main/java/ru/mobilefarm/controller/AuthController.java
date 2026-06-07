package ru.mobilefarm.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;
import ru.mobilefarm.model.User;
import ru.mobilefarm.service.JwtService;
import ru.mobilefarm.service.UserRepository;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public AuthController(UserRepository userRepository,
                          PasswordEncoder passwordEncoder,
                          JwtService jwtService) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request) {
        var user = userRepository.findByUsername(request.username());
        if (user.isEmpty() || !passwordEncoder.matches(request.password(), user.get().getPassword())) {
            return ResponseEntity.status(401).body(Map.of("error", "Invalid credentials"));
        }
        String token = jwtService.generateToken(user.get());
        return ResponseEntity.ok(Map.of(
                "token", token,
                "username", user.get().getUsername(),
                "role", user.get().getRole().name()
        ));
    }

    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody RegisterRequest request) {
        if (userRepository.existsByUsername(request.username())) {
            return ResponseEntity.badRequest().body(Map.of("error", "Username already taken"));
        }
        var user = new User();
        user.setUsername(request.username());
        user.setEmail(request.email());
        user.setPassword(passwordEncoder.encode(request.password()));
        userRepository.save(user);
        String token = jwtService.generateToken(user);
        return ResponseEntity.ok(Map.of("token", token, "username", user.getUsername()));
    }

    record LoginRequest(String username, String password) {}
    record RegisterRequest(String username, String email, String password) {}
}
