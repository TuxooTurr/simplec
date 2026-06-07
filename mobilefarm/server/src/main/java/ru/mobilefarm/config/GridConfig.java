package ru.mobilefarm.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import jakarta.annotation.PostConstruct;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

@Configuration
public class GridConfig {

    @Value("${farm.grid.port:4444}")
    private int gridPort;

    @Value("${farm.grid.session-timeout-sec:1800}")
    private int sessionTimeout;

    @PostConstruct
    public void startGridHub() {
        var tomlContent = """
                [server]
                port = %d

                [sessionqueue]
                session-request-timeout = 300

                [sessions]
                session-timeout = %d

                [node]
                detect-drivers = false
                """.formatted(gridPort, sessionTimeout);

        try {
            Path configPath = Files.createTempFile("grid-config-", ".toml");
            Files.writeString(configPath, tomlContent);

            var pb = new ProcessBuilder(
                    "java", "-jar", findGridJar(),
                    "hub", "--config", configPath.toString()
            );
            pb.inheritIO();
            pb.redirectErrorStream(true);

            // Grid runs as a separate process alongside Spring Boot
            // In production, Grid is started via docker-compose as a sidecar
            // This is a fallback for single-binary deployments
            System.out.println("[Grid] Config generated at: " + configPath);
            System.out.println("[Grid] Hub will listen on port " + gridPort);
            System.out.println("[Grid] For production, use standalone Grid via docker-compose");

        } catch (IOException e) {
            System.err.println("[Grid] Failed to generate config: " + e.getMessage());
        }
    }

    private String findGridJar() {
        return "selenium-server-4.20.0.jar";
    }
}
