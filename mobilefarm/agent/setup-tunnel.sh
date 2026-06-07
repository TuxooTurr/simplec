#!/bin/bash
# Setup pymobiledevice3 tunneld as a system daemon
# This allows screenshot and developer services for iOS 17+ devices

PLIST="/Library/LaunchDaemons/com.mobilefarm.tunneld.plist"
PY3=$(which python3)

echo "=== MobileFarm iOS Tunnel Setup ==="
echo ""
echo "This will install a system daemon that enables screen capture"
echo "for connected iOS devices (required for iOS 17+)."
echo ""

if [ "$EUID" -ne 0 ]; then
    echo "Re-running with sudo..."
    exec sudo "$0" "$@"
fi

cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.mobilefarm.tunneld</string>
    <key>ProgramArguments</key>
    <array>
        <string>$PY3</string>
        <string>-m</string>
        <string>pymobiledevice3</string>
        <string>remote</string>
        <string>tunneld</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/mobilefarm-tunneld.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/mobilefarm-tunneld.log</string>
</dict>
</plist>
EOF

chmod 644 "$PLIST"

# Stop if already loaded
launchctl bootout system/com.mobilefarm.tunneld 2>/dev/null

# Load the daemon
launchctl bootstrap system "$PLIST"

echo ""
echo "Tunnel daemon started. Checking status..."
sleep 2

if launchctl print system/com.mobilefarm.tunneld 2>/dev/null | grep -q "state = running"; then
    echo "OK: tunneld is running"
else
    echo "Starting manually..."
    launchctl kickstart system/com.mobilefarm.tunneld
    sleep 2
fi

echo ""
echo "Done! iOS developer services (screenshots) are now available."
echo "Log: /tmp/mobilefarm-tunneld.log"
