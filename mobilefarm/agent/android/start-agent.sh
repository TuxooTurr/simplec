#!/usr/bin/env bash
set -euo pipefail

FARM_HUB_URL="${FARM_HUB_URL:-http://localhost:8080}"
GRID_URL="${GRID_URL:-http://localhost:4444}"
APPIUM_BASE_PORT="${APPIUM_BASE_PORT:-4723}"
HEARTBEAT_INTERVAL="${HEARTBEAT_INTERVAL:-15}"

echo "=== Mobile Farm — Android Agent ==="
echo "Hub: $FARM_HUB_URL"
echo "Grid: $GRID_URL"

adb start-server

DEVICES=$(adb devices | grep -w 'device' | awk '{print $1}')
if [ -z "$DEVICES" ]; then
    echo "No Android devices connected."
    exit 1
fi

REGISTERED_UDIDS=()
PORT=$APPIUM_BASE_PORT

for UDID in $DEVICES; do
    MODEL=$(adb -s "$UDID" shell getprop ro.product.model 2>/dev/null | tr -d '\r')
    OS_VER=$(adb -s "$UDID" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r')

    echo "[$UDID] Starting Appium for $MODEL (Android $OS_VER) on port $PORT..."

    appium server \
        --port "$PORT" \
        --default-capabilities "{\"appium:udid\": \"$UDID\", \"platformName\": \"Android\", \"appium:deviceName\": \"$MODEL\"}" \
        --use-drivers uiautomator2 \
        --selenium-grid-url "$GRID_URL" \
        --log "/tmp/appium-$UDID.log" &

    echo "[$UDID] Appium PID: $!"

    curl -sf -X POST "$FARM_HUB_URL/api/v1/agents/register" \
        -H "Content-Type: application/json" \
        -d "{
            \"udid\": \"$UDID\",
            \"platform\": \"ANDROID\",
            \"model\": \"$MODEL\",
            \"osVersion\": \"$OS_VER\",
            \"appiumPort\": $PORT,
            \"agentHost\": \"$(hostname)\"
        }" && echo "[$UDID] Registered with hub" || echo "[$UDID] Warning: registration failed"

    REGISTERED_UDIDS+=("$UDID")
    PORT=$((PORT + 1))
done

echo ""
echo "Android Agent started. Devices: ${#REGISTERED_UDIDS[@]}"
echo "Starting heartbeat loop (every ${HEARTBEAT_INTERVAL}s)..."

heartbeat_loop() {
    while true; do
        sleep "$HEARTBEAT_INTERVAL"
        for UDID in "${REGISTERED_UDIDS[@]}"; do
            BATTERY=$(adb -s "$UDID" shell dumpsys battery 2>/dev/null | grep level | awk '{print $2}' | tr -d '\r' || echo "0")
            ONLINE=$(adb -s "$UDID" get-state 2>/dev/null | tr -d '\r' || echo "offline")

            if [ "$ONLINE" = "device" ]; then
                curl -sf -X POST "$FARM_HUB_URL/api/v1/agents/heartbeat" \
                    -H "Content-Type: application/json" \
                    -d "{\"udid\": \"$UDID\", \"battery\": ${BATTERY:-0}}" >/dev/null 2>&1 || true
            fi
        done
    done
}

heartbeat_loop &
HEARTBEAT_PID=$!

cleanup() {
    echo "Shutting down..."
    kill $HEARTBEAT_PID 2>/dev/null || true
    kill $(jobs -p) 2>/dev/null || true
    wait
}
trap cleanup EXIT INT TERM

wait
