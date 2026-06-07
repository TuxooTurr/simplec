#!/usr/bin/env bash
cd "$(dirname "$0")" && ./gradlew bootRun --args='--spring.profiles.active=dev'
