package ru.mobilefarm.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import ru.mobilefarm.device.DeviceStatusHandler;
import ru.mobilefarm.device.ScreenStreamHandler;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final DeviceStatusHandler deviceStatusHandler;
    private final ScreenStreamHandler screenStreamHandler;

    public WebSocketConfig(DeviceStatusHandler deviceStatusHandler,
                           ScreenStreamHandler screenStreamHandler) {
        this.deviceStatusHandler = deviceStatusHandler;
        this.screenStreamHandler = screenStreamHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(deviceStatusHandler, "/ws/devices")
                .setAllowedOrigins("*");
        registry.addHandler(screenStreamHandler, "/ws/screen/{udid}")
                .setAllowedOrigins("*");
    }
}
