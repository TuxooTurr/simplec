#!/usr/bin/env bash
set -euo pipefail

FARM_HUB_URL="${FARM_HUB_URL:-http://localhost:8080}"
GRID_URL="${GRID_URL:-http://localhost:4444}"
APPIUM_BASE_PORT="${APPIUM_BASE_PORT:-4730}"
WDA_BASE_PORT="${WDA_BASE_PORT:-8100}"
HEARTBEAT_INTERVAL="${HEARTBEAT_INTERVAL:-15}"

echo "=== Mobile Farm — iOS Agent ==="
echo "Hub: $FARM_HUB_URL"
echo "Grid: $GRID_URL"

if ! command -v ios &>/dev/null; then
    echo "Error: go-ios not found. Install: brew install danielpaulus/tap/go-ios"
    exit 1
fi

DEVICES=$(ios list 2>/dev/null | jq -r '.deviceList[].serialNumber' 2>/dev/null || true)
if [ -z "$DEVICES" ]; then
    echo "No iOS devices connected."
    exit 1
fi

REGISTERED_UDIDS=()
APPIUM_PORT=$APPIUM_BASE_PORT
WDA_PORT=$WDA_BASE_PORT

for UDID in $DEVICES; do
    MODEL=$(ios info --udid "$UDID" 2>/dev/null | jq -r '.ProductType' || echo "Unknown")
    OS_VER=$(ios info --udid "$UDID" 2>/dev/null | jq -r '.ProductVersion' || echo "Unknown")
    DEVICE_NAME=$(ios info --udid "$UDID" 2>/dev/null | jq -r '.DeviceName' || echo "$MODEL")

    echo "[$UDID] Starting WDA proxy for $DEVICE_NAME ($MODEL, iOS $OS_VER) on port $WDA_PORT..."
    ios forward "$UDID" "$WDA_PORT" 8100 &

    echo "[$UDID] Starting Appium on port $APPIUM_PORT..."
    appium server \
        --port "$APPIUM_PORT" \
        --default-capabilities "{
            \"appium:udid\": \"$UDID\",
            \"platformName\": \"iOS\",
            \"appium:deviceName\": \"$DEVICE_NAME\",
            \"appium:wdaLocalPort\": $WDA_PORT,
            \"appium:platformVersion\": \"$OS_VER\"
        }" \
        --use-drivers xcuitest \
        --selenium-grid-url "$GRID_URL" \
        --log "/tmp/appium-ios-$UDID.log" &

    echo "[$UDID] Appium PID: $!"

    curl -sf -X POST "$FARM_HUB_URL/api/v1/agents/register" \
        -H "Content-Type: application/json" \
        -d "{
            \"udid\": \"$UDID\",
            \"platform\": \"IOS\",
            \"model\": \"$DEVICE_NAME ($MODEL)\",
            \"osVersion\": \"$OS_VER\",
            \"appiumPort\": $APPIUM_PORT,
            \"agentHost\": \"$(hostname)\"
        }" && echo "[$UDID] Registered with hub" || echo "[$UDID] Warning: registration failed"

    REGISTERED_UDIDS+=("$UDID")
    APPIUM_PORT=$((APPIUM_PORT + 1))
    WDA_PORT=$((WDA_PORT + 1))
done

echo ""
echo "iOS Agent started. Devices: ${#REGISTERED_UDIDS[@]}"
echo "Starting heartbeat loop (every ${HEARTBEAT_INTERVAL}s)..."

heartbeat_loop() {
    while true; do
        sleep "$HEARTBEAT_INTERVAL"
        for UDID in "${REGISTERED_UDIDS[@]}"; do
            BATTERY=$(ios info --udid "$UDID" 2>/dev/null | jq -r '.BatteryCurrentCapacity // 0' || echo "0")

            # Check if device is still connected
            if ios list 2>/dev/null | jq -r '.deviceList[].serialNumber' | grep -q "$UDID"; then
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
