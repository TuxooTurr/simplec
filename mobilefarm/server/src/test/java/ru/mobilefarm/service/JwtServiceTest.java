package ru.mobilefarm.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import ru.mobilefarm.model.User;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class JwtServiceTest {

    private JwtService jwtService;

    @BeforeEach
    void setUp() {
        jwtService = new JwtService("test-secret-key-for-unit-tests-minimum-32-bytes-long", 3600000);
    }

    @Test
    void generateAndValidateToken() {
        User user = createUser("testuser", User.Role.USER);
        String token = jwtService.generateToken(user);

        assertNotNull(token);
        assertTrue(jwtService.isValid(token));
        assertEquals("testuser", jwtService.getUsername(token));
        assertEquals("USER", jwtService.getRole(token));
    }

    @Test
    void adminTokenContainsAdminRole() {
        User user = createUser("admin", User.Role.ADMIN);
        String token = jwtService.generateToken(user);

        assertEquals("ADMIN", jwtService.getRole(token));
    }

    @Test
    void invalidTokenReturnsFalse() {
        assertFalse(jwtService.isValid("invalid.token.here"));
        assertFalse(jwtService.isValid(""));
    }

    @Test
    void tamperedTokenIsInvalid() {
        User user = createUser("testuser", User.Role.USER);
        String token = jwtService.generateToken(user);
        String tampered = token.substring(0, token.length() - 5) + "XXXXX";

        assertFalse(jwtService.isValid(tampered));
    }

    @Test
    void differentSecretCannotValidate() {
        User user = createUser("testuser", User.Role.USER);
        String token = jwtService.generateToken(user);

        JwtService otherService = new JwtService("different-secret-key-also-minimum-32-bytes-long!", 3600000);
        assertFalse(otherService.isValid(token));
    }

    private User createUser(String username, User.Role role) {
        var user = new User();
        user.setId(UUID.randomUUID());
        user.setUsername(username);
        user.setPassword("hashed");
        user.setRole(role);
        return user;
    }
}
