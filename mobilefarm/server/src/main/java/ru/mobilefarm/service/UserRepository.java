package ru.mobilefarm.service;

import org.springframework.data.jpa.repository.JpaRepository;
import ru.mobilefarm.model.User;

import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByUsername(String username);

    boolean existsByUsername(String username);
}
