#!/usr/bin/env bash
set -euo pipefail

echo "=== Mobile Farm — Mac Setup ==="

# Prerequisites
echo "Checking prerequisites..."

command -v brew >/dev/null || { echo "Install Homebrew first: https://brew.sh"; exit 1; }
command -v java >/dev/null || { echo "Installing Java 21..."; brew install --cask temurin@21; }
command -v node >/dev/null || { echo "Installing Node.js..."; brew install node; }
command -v docker >/dev/null || { echo "Install Docker Desktop first: https://docker.com/products/docker-desktop"; exit 1; }

# Appium
echo "Installing Appium 2..."
npm install -g appium 2>/dev/null || true
appium driver install uiautomator2 2>/dev/null || true
appium driver install xcuitest 2>/dev/null || true

# Android tools
echo "Installing Android tools..."
brew install --cask android-platform-tools 2>/dev/null || true

# iOS tools
echo "Installing iOS tools..."
brew install danielpaulus/tap/go-ios 2>/dev/null || true

# Verify
echo ""
echo "=== Verification ==="
echo "Java:    $(java --version 2>&1 | head -1)"
echo "Node:    $(node --version)"
echo "Appium:  $(appium --version 2>/dev/null || echo 'not found')"
echo "ADB:     $(adb --version 2>/dev/null | head -1 || echo 'not found')"
echo "go-ios:  $(ios version 2>/dev/null || echo 'not found')"
echo "Docker:  $(docker --version)"
echo ""
echo "Next steps:"
echo "  1. cp .env.example .env && edit .env"
echo "  2. docker compose up -d"
echo "  3. Connect devices via USB"
echo "  4. ./agent/android/start-agent.sh"
echo "  5. ./agent/ios/start-agent.sh"
echo "  6. Open http://localhost:3000"
