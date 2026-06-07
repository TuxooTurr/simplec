plugins {
    `java-library`
}

group = "ru.mobilefarm"
version = "0.1.0"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    api("io.appium:java-client:9.2.0")
    api("org.seleniumhq.selenium:selenium-java:4.20.0")
}
