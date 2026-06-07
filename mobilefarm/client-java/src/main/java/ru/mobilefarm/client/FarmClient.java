package ru.mobilefarm.client;

import io.appium.java_client.android.AndroidDriver;
import io.appium.java_client.ios.IOSDriver;
import org.openqa.selenium.remote.DesiredCapabilities;

import java.net.MalformedURLException;
import java.net.URI;
import java.net.URL;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

/**
 * Java client for Mobile Farm.
 * Provides both direct device management via Farm Hub API
 * and Appium WebDriver sessions via Selenium Grid.
 */
public class FarmClient {

    private final String hubUrl;
    private final String gridUrl;
    private final String token;
    private final HttpClient http = HttpClient.newHttpClient();

    private FarmClient(String hubUrl, String gridUrl, String token) {
        this.hubUrl = hubUrl;
        this.gridUrl = gridUrl;
        this.token = token;
    }

    public static FarmClient connect(String hubUrl, String username, String password) throws Exception {
        var http = HttpClient.newHttpClient();
        var loginRequest = HttpRequest.newBuilder()
                .uri(URI.create(hubUrl + "/api/v1/auth/login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(
                        "{\"username\":\"%s\",\"password\":\"%s\"}".formatted(username, password)))
                .build();

        var response = http.send(loginRequest, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new RuntimeException("Login failed: " + response.body());
        }

        String token = response.body().replaceAll(".*\"token\":\"([^\"]+)\".*", "$1");
        String gridUrl = hubUrl.replaceFirst(":\\d+$", ":4444");
        return new FarmClient(hubUrl, gridUrl, token);
    }

    public AndroidDriver androidDriver(String deviceName) throws MalformedURLException {
        var caps = new DesiredCapabilities();
        caps.setCapability("platformName", "Android");
        caps.setCapability("appium:deviceName", deviceName);
        caps.setCapability("appium:automationName", "UiAutomator2");
        return new AndroidDriver(gridUrl(), caps);
    }

    public AndroidDriver androidDriver(String deviceName, String appPath) throws MalformedURLException {
        var caps = new DesiredCapabilities();
        caps.setCapability("platformName", "Android");
        caps.setCapability("appium:deviceName", deviceName);
        caps.setCapability("appium:automationName", "UiAutomator2");
        caps.setCapability("appium:app", appPath);
        return new AndroidDriver(gridUrl(), caps);
    }

    public IOSDriver iosDriver(String deviceName) throws MalformedURLException {
        var caps = new DesiredCapabilities();
        caps.setCapability("platformName", "iOS");
        caps.setCapability("appium:deviceName", deviceName);
        caps.setCapability("appium:automationName", "XCUITest");
        return new IOSDriver(gridUrl(), caps);
    }

    public IOSDriver iosDriver(String deviceName, String bundleId) throws MalformedURLException {
        var caps = new DesiredCapabilities();
        caps.setCapability("platformName", "iOS");
        caps.setCapability("appium:deviceName", deviceName);
        caps.setCapability("appium:automationName", "XCUITest");
        caps.setCapability("appium:bundleId", bundleId);
        return new IOSDriver(gridUrl(), caps);
    }

    public String listDevices() throws Exception {
        var request = HttpRequest.newBuilder()
                .uri(URI.create(hubUrl + "/api/v1/devices"))
                .header("Authorization", "Bearer " + token)
                .GET().build();
        return http.send(request, HttpResponse.BodyHandlers.ofString()).body();
    }

    public String listDevices(String platform, String status) throws Exception {
        var params = "?platform=" + platform + "&status=" + status;
        var request = HttpRequest.newBuilder()
                .uri(URI.create(hubUrl + "/api/v1/devices" + params))
                .header("Authorization", "Bearer " + token)
                .GET().build();
        return http.send(request, HttpResponse.BodyHandlers.ofString()).body();
    }

    public void lockDevice(String udid) throws Exception {
        var request = HttpRequest.newBuilder()
                .uri(URI.create(hubUrl + "/api/v1/devices/" + udid + "/lock"))
                .header("Authorization", "Bearer " + token)
                .POST(HttpRequest.BodyPublishers.noBody()).build();
        http.send(request, HttpResponse.BodyHandlers.ofString());
    }

    public void unlockDevice(String udid) throws Exception {
        var request = HttpRequest.newBuilder()
                .uri(URI.create(hubUrl + "/api/v1/devices/" + udid + "/unlock"))
                .header("Authorization", "Bearer " + token)
                .POST(HttpRequest.BodyPublishers.noBody()).build();
        http.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private URL gridUrl() throws MalformedURLException {
        return URI.create(gridUrl + "/wd/hub").toURL();
    }
}
