#!/usr/bin/env python3
"""
MobileFarm Screenshot Agent Server
Lightweight HTTP server providing device screenshots.
Runs on port 9100 by default.

Endpoints:
  GET /screenshot/<udid>    - Returns PNG screenshot
  GET /devices              - Lists connected iOS devices
  GET /health               - Health check
"""

import json
import os
import subprocess
import tempfile
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from threading import Lock

AGENT_DIR = Path(__file__).parent
MIRROR_CAPTURE = AGENT_DIR / "ios-screenshot" / "mirror-capture"
PORT = int(os.environ.get("SCREENSHOT_PORT", "9100"))

_cache: dict[str, tuple[float, bytes]] = {}
_cache_lock = Lock()
CACHE_TTL = 0.5


def get_ios_devices() -> list[dict]:
    try:
        result = subprocess.run(
            ["idevice_id", "-l"], capture_output=True, text=True, timeout=5
        )
        udids = result.stdout.strip().split("\n")
        devices = []
        for udid in udids:
            if not udid.strip():
                continue
            info = {"udid": udid.strip(), "platform": "IOS"}
            try:
                r = subprocess.run(
                    ["ideviceinfo", "-u", udid.strip(), "-k", "ProductType"],
                    capture_output=True, text=True, timeout=5,
                )
                info["model"] = r.stdout.strip()
            except Exception:
                pass
            devices.append(info)
        return devices
    except Exception:
        return []


def take_screenshot_mirror(udid: str, output_path: str) -> bool:
    """Capture iPhone Mirroring window via macOS screencapture."""
    try:
        result = subprocess.run(
            [str(MIRROR_CAPTURE)],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return False
        wid = result.stdout.strip()
        if not wid:
            return False
        r = subprocess.run(
            ["screencapture", "-l", wid, "-x", output_path],
            capture_output=True, timeout=5,
        )
        return r.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 500
    except Exception:
        return False


def take_screenshot_pymobiledevice3(udid: str, output_path: str) -> bool:
    try:
        result = subprocess.run(
            ["pymobiledevice3", "developer", "screenshot", output_path],
            capture_output=True, text=True, timeout=10,
        )
        return result.returncode == 0 and os.path.exists(output_path)
    except Exception:
        return False


def take_screenshot_adb(udid: str, output_path: str) -> bool:
    try:
        result = subprocess.run(
            ["adb", "-s", udid, "exec-out", "screencap", "-p"],
            capture_output=True, timeout=10,
        )
        if result.returncode == 0 and len(result.stdout) > 100:
            with open(output_path, "wb") as f:
                f.write(result.stdout)
            return True
    except Exception:
        pass
    return False


def take_screenshot(udid: str) -> bytes | None:
    with _cache_lock:
        if udid in _cache:
            ts, data = _cache[udid]
            if time.time() - ts < CACHE_TTL:
                return data

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        tmp = f.name

    try:
        methods = [
            take_screenshot_mirror,
            take_screenshot_pymobiledevice3,
            take_screenshot_adb,
        ]

        for method in methods:
            if os.path.exists(tmp):
                os.unlink(tmp)
            if method(udid, tmp):
                with open(tmp, "rb") as f:
                    data = f.read()
                with _cache_lock:
                    _cache[udid] = (time.time(), data)
                return data

        return None
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


class ScreenshotHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.path == "/health":
            self._json_response({"status": "ok"})

        elif self.path == "/devices":
            devices = get_ios_devices()
            self._json_response(devices)

        elif self.path.startswith("/screenshot/"):
            udid = self.path.split("/screenshot/")[1].split("?")[0]
            data = take_screenshot(udid)
            if data:
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(data)
            else:
                self._json_response({"error": "Screenshot failed"}, 500)

        else:
            self._json_response({"error": "Not found"}, 404)

    def _json_response(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), ScreenshotHandler)
    print(f"Screenshot server running on port {PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
