package ru.mobilefarm.client;

import org.openqa.selenium.WebDriver;

/**
 * Base class for farm-connected test suites.
 * Extend this in your Java 21 test framework.
 *
 * Usage:
 * <pre>
 * public class MyTest extends FarmTestBase {
 *     @Test
 *     void testLogin() throws Exception {
 *         var driver = farm().androidDriver("Pixel 7", "/path/to/app.apk");
 *         try {
 *             driver.findElement(AppiumBy.id("login_btn")).click();
 *         } finally {
 *             driver.quit();
 *         }
 *     }
 * }
 * </pre>
 */
public abstract class FarmTestBase {

    private static FarmClient client;

    protected static FarmClient farm() {
        if (client == null) {
            String url = System.getProperty("farm.url", "http://localhost:8080");
            String user = System.getProperty("farm.user", "admin");
            String pass = System.getProperty("farm.password", "admin");
            try {
                client = FarmClient.connect(url, user, pass);
            } catch (Exception e) {
                throw new RuntimeException("Failed to connect to farm: " + e.getMessage(), e);
            }
        }
        return client;
    }

    protected static void releaseDriver(WebDriver driver) {
        if (driver != null) {
            driver.quit();
        }
    }
}
