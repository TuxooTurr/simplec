package ru.mobilefarm;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class MobileFarmApplication {

    public static void main(String[] args) {
        SpringApplication.run(MobileFarmApplication.class, args);
    }
}
