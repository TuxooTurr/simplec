#!/bin/bash
# Sends periodic heartbeats for connected iOS devices to Farm Hub
HUB_URL="${HUB_URL:-http://localhost:8080}"
INTERVAL=30

while true; do
    for udid in $(idevice_id -l 2>/dev/null); do
        battery=$(ideviceinfo -u "$udid" -q com.apple.mobile.battery 2>/dev/null | grep BatteryCurrentCapacity | awk '{print $2}')
        battery=${battery:-0}
        curl -s -X POST "$HUB_URL/api/v1/agents/heartbeat" \
            -H 'Content-Type: application/json' \
            -d "{\"udid\":\"$udid\",\"battery\":$battery}" > /dev/null 2>&1
    done
    sleep $INTERVAL
done
