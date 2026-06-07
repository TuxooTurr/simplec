"use client";

import { useState, useEffect, useCallback, useRef, type MouseEvent as ReactMouseEvent } from "react";
import {
  Smartphone, Search, Loader2, Wifi, WifiOff, RefreshCw,
  Maximize2, Minimize2, X, Home, ArrowLeft, LayoutGrid,
  ChevronDown, Volume2, VolumeX, Power, Type, Send,
  Columns2, Columns3, Square, Clock, User, Trash2,
  MonitorSmartphone, Settings,
} from "lucide-react";
import {
  getFarmDevices, lockFarmDevice, unlockFarmDevice, getFarmSessions,
  getActiveFarmSessions, forceReleaseFarmSession,
  type FarmDevice, type FarmSession, type DevicePlatform, type DeviceStatus,
} from "@/lib/deviceFarmApi";
import { authHeaders } from "@/lib/authApi";

/* ── Стили (дизайн-система) ─────────────────────────────────────────────── */

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm " +
  "bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 " +
  "transition-shadow duration-150";

const SELECT_CLS =
  "border border-border-main rounded-lg px-3 py-2 text-sm bg-bg-card text-text-main " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow";

const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium " +
  "rounded-lg bg-primary text-white shadow-sm hover:bg-primary-dark " +
  "disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

const BTN_GHOST =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium " +
  "rounded-lg text-text-muted hover:bg-bg-subtle hover:text-text-main " +
  "transition-colors";

const BADGE_CLS = "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full";

/* ── Константы ──────────────────────────────────────────────────────────── */

const STATUS_STYLES: Record<DeviceStatus, { dot: string; bg: string; text: string; label: string }> = {
  AVAILABLE:   { dot: "bg-green-500",  bg: "bg-green-50",  text: "text-green-700",  label: "Свободен" },
  BUSY:        { dot: "bg-amber-500",  bg: "bg-amber-50",  text: "text-amber-700",  label: "Занят" },
  OFFLINE:     { dot: "bg-gray-400",   bg: "bg-gray-100",  text: "text-gray-600",   label: "Офлайн" },
  MAINTENANCE: { dot: "bg-blue-500",   bg: "bg-blue-50",   text: "text-blue-700",   label: "Обслуживание" },
};

const PLATFORM_LABEL: Record<DevicePlatform, string> = {
  ANDROID: "Android",
  IOS: "iOS",
};

type TabId = "devices" | "workspace" | "sessions";

/* ── Утилиты ────────────────────────────────────────────────────────────── */

function batteryColor(level: number | null): string {
  if (level === null) return "bg-gray-300";
  if (level > 50) return "bg-green-500";
  if (level > 20) return "bg-yellow-500";
  return "bg-red-500";
}

function formatDuration(startedAt: string, endedAt?: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const diffMs = end - start;
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const m = mins % 60;
  if (hours > 0) return `${hours}ч ${m}м`;
  return `${m}м`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/* ── Device Card ────────────────────────────────────────────────────────── */

function DeviceCard({
  device, onLock, onUnlock, onOpenWorkspace, locking,
}: {
  device: FarmDevice;
  onLock: (udid: string) => void;
  onUnlock: (udid: string) => void;
  onOpenWorkspace: (udid: string) => void;
  locking: string | null;
}) {
  const st = STATUS_STYLES[device.status];
  const isLocking = locking === device.udid;

  return (
    <div className="bg-bg-card border border-border-main rounded-xl p-4 hover:border-primary/30 transition-colors">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-primary/5 flex items-center justify-center flex-shrink-0">
          <Smartphone className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-main truncate">{device.model}</h3>
          <p className="text-xs text-text-muted">
            {PLATFORM_LABEL[device.platform]} {device.osVersion}
          </p>
        </div>
        <span className={`${BADGE_CLS} ${st.bg} ${st.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
          {st.label}
        </span>
      </div>

      {/* Info */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">UDID</span>
          <span className="text-text-main font-mono text-[11px] truncate max-w-[140px]" title={device.udid}>
            {device.udid}
          </span>
        </div>

        {/* Battery */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">Батарея</span>
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 bg-bg-main rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${batteryColor(device.battery)}`}
                style={{ width: `${device.battery ?? 0}%` }}
              />
            </div>
            <span className="text-text-main w-8 text-right">
              {device.battery !== null ? `${device.battery}%` : "--"}
            </span>
          </div>
        </div>

        {device.lockedBy && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Заблокирован</span>
            <span className="text-amber-600 font-medium truncate max-w-[140px]">{device.lockedBy}</span>
          </div>
        )}

        {device.lastSeen && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Последний раз</span>
            <span className="text-text-main">{formatTime(device.lastSeen)}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-border-main">
        {device.status === "AVAILABLE" && (
          <button
            onClick={() => onLock(device.udid)}
            disabled={isLocking}
            className={`${BTN_PRIMARY} flex-1 text-xs py-1.5`}
          >
            {isLocking ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Захватить
          </button>
        )}
        {device.status === "BUSY" && device.lockedBy && (
          <>
            <button
              onClick={() => onUnlock(device.udid)}
              disabled={isLocking}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium
                rounded-lg border border-border-main text-text-main hover:bg-bg-subtle
                disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLocking ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              Освободить
            </button>
            <button
              onClick={() => onOpenWorkspace(device.udid)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium
                rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              <MonitorSmartphone className="w-3 h-3" />
              На рабочий стол
            </button>
          </>
        )}
        {(device.status === "OFFLINE" || device.status === "MAINTENANCE") && (
          <span className="text-xs text-text-muted py-1.5">
            {device.status === "OFFLINE" ? "Устройство недоступно" : "На обслуживании"}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── H.264 NAL helpers ─────────────────────────────────────────────────── */

const NAL_NON_IDR = 1;
const NAL_IDR = 5;
const NAL_SPS = 7;
const NAL_PPS = 8;

/** Find the NAL unit type from the first start code in the data. */
function getNalType(data: Uint8Array): number {
  for (let i = 0; i < data.length - 4; i++) {
    if (data[i] === 0 && data[i + 1] === 0) {
      if (data[i + 2] === 0 && data[i + 3] === 1) {
        return data[i + 4] & 0x1f;
      }
      if (data[i + 2] === 1) {
        return data[i + 3] & 0x1f;
      }
    }
  }
  return data[0] & 0x1f;
}

/** Extract the avc1 codec string from raw SPS NAL data. */
function getCodecFromSPS(sps: Uint8Array): string {
  let spsStart = -1;
  for (let i = 0; i < sps.length - 4; i++) {
    if (sps[i] === 0 && sps[i + 1] === 0 && sps[i + 2] === 0 && sps[i + 3] === 1) {
      if ((sps[i + 4] & 0x1f) === NAL_SPS) { spsStart = i + 4; break; }
    }
    if (sps[i] === 0 && sps[i + 1] === 0 && sps[i + 2] === 1) {
      if ((sps[i + 3] & 0x1f) === NAL_SPS) { spsStart = i + 3; break; }
    }
  }
  if (spsStart < 0) return "avc1.640028";
  const profile = sps[spsStart + 1];
  const compat = sps[spsStart + 2];
  const level = sps[spsStart + 3];
  return `avc1.${profile.toString(16).padStart(2, "0")}${compat.toString(16).padStart(2, "0")}${level.toString(16).padStart(2, "0")}`;
}

/** Check whether the browser supports WebCodecs VideoDecoder. */
function hasWebCodecs(): boolean {
  return typeof VideoDecoder !== "undefined";
}

/* ── Device Panel (Workspace) ───────────────────────────────────────────── */

function DevicePanel({
  udid, model, platform, onClose,
}: {
  udid: string;
  model: string;
  platform: DevicePlatform;
  onClose: (udid: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const configDataRef = useRef<Uint8Array | null>(null);
  const tsRef = useRef(0);
  const frameCountRef = useRef(0);
  const touchActiveRef = useRef(false);
  const lastMoveRef = useRef(0);
  const touchDotRef = useRef<HTMLDivElement>(null);
  /* UX gesture detection (tap / swipe / longpress) on top of raw touch */
  const dragStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* PNG fallback: used only when WebCodecs is unavailable */
  const fallbackImgRef = useRef<HTMLImageElement | null>(null);
  const usingFallbackRef = useRef(!hasWebCodecs());

  const [connected, setConnected] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [textInput, setTextInput] = useState("");
  const [videoSize, setVideoSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [fps, setFps] = useState(0);
  const [hasFrame, setHasFrame] = useState(false);

  /* ── FPS counter ──────────────────────────────────────────────────────── */
  useEffect(() => {
    const interval = setInterval(() => {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  /* ── WebSocket + VideoDecoder / fallback ──────────────────────────────── */
  useEffect(() => {
    const wsBase = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000")
      .replace(/^http/, "ws");
    const token = typeof window !== "undefined" ? localStorage.getItem("st_auth_token") ?? "" : "";
    const wsUrl = `${wsBase}/api/farm/ws/screen/${encodeURIComponent(udid)}${token ? `?token=${token}` : ""}`;

    let ws: WebSocket;
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let decoder: VideoDecoder | null = null;
    let destroyed = false;

    /* Draw a decoded VideoFrame to the canvas */
    function drawFrame(frame: VideoFrame) {
      const canvas = canvasRef.current;
      if (!canvas) { frame.close(); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) { frame.close(); return; }
      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
        setVideoSize({ width: frame.displayWidth, height: frame.displayHeight });
      }
      ctx.drawImage(frame, 0, 0);
      frame.close();
      frameCountRef.current++;
      if (!destroyed) setHasFrame(true);
    }

    /* Create the VideoDecoder (only if WebCodecs available) */
    function createDecoder() {
      if (!hasWebCodecs()) return null;
      const dec = new VideoDecoder({
        output: drawFrame,
        error: (e) => {
          console.warn("[DevicePanel] VideoDecoder error:", e);
        },
      });
      return dec;
    }

    /* PNG/JPEG fallback rendering */
    let fallbackUrl: string | null = null;
    function handleFallbackBinary(data: ArrayBuffer) {
      if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
      const blob = new Blob([data], { type: "image/png" });
      fallbackUrl = URL.createObjectURL(blob);

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (!fallbackImgRef.current) {
        fallbackImgRef.current = new Image();
      }
      const img = fallbackImgRef.current;
      img.onload = () => {
        if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          setVideoSize({ width: img.naturalWidth, height: img.naturalHeight });
        }
        ctx.drawImage(img, 0, 0);
        frameCountRef.current++;
        if (!destroyed) setHasFrame(true);
      };
      img.src = fallbackUrl;
    }

    /* Handle binary WS messages */
    function handleBinary(data: ArrayBuffer) {
      if (usingFallbackRef.current) {
        handleFallbackBinary(data);
        return;
      }

      if (!decoder || decoder.state === "closed") return;

      const uint8 = new Uint8Array(data);
      const nalType = getNalType(uint8);

      if (nalType === NAL_SPS || nalType === NAL_PPS) {
        /* SPS/PPS — configure decoder */
        if (configDataRef.current) {
          const merged = new Uint8Array(configDataRef.current.length + uint8.length);
          merged.set(configDataRef.current);
          merged.set(uint8, configDataRef.current.length);
          configDataRef.current = merged;
        } else {
          configDataRef.current = new Uint8Array(uint8);
        }

        const codecStr = getCodecFromSPS(configDataRef.current);
        try {
          if ((decoder.state as string) !== "closed") {
            decoder.configure({
              codec: codecStr,
              optimizeForLatency: true,
            });
          }
        } catch (e) {
          console.warn("[DevicePanel] Failed to configure decoder:", e);
        }
        return;
      }

      /* Regular frame data */
      if (decoder.state !== "configured") return;

      const isKey = nalType === NAL_IDR;
      try {
        const chunk = new EncodedVideoChunk({
          type: isKey ? "key" : "delta",
          timestamp: tsRef.current,
          data: uint8,
        });
        tsRef.current += 16667; /* ~60fps in microseconds */
        decoder.decode(chunk);
      } catch (e) {
        console.warn("[DevicePanel] decode error:", e);
      }
    }

    /* Handle text (JSON) WS messages */
    function handleText(text: string) {
      try {
        const msg = JSON.parse(text);
        if (msg.type === "video_start" && msg.width && msg.height) {
          setVideoSize({ width: msg.width, height: msg.height });
          /* If the server says h264 but browser has no WebCodecs, stay in fallback */
          if (msg.codec === "h264" && !hasWebCodecs()) {
            usingFallbackRef.current = true;
          } else if (msg.codec === "h264") {
            usingFallbackRef.current = false;
          }
        }
      } catch {
        /* ignore non-JSON text */
      }
    }

    function connect() {
      ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      decoder = createDecoder();
      decoderRef.current = decoder;
      configDataRef.current = null;
      tsRef.current = 0;

      ws.onopen = () => {
        if (!destroyed) setConnected(true);
      };

      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          handleBinary(ev.data);
        } else if (typeof ev.data === "string") {
          handleText(ev.data);
        }
      };

      ws.onclose = () => {
        if (!destroyed) {
          setConnected(false);
          setHasFrame(false);
        }
        try { decoder?.close(); } catch { /* already closed */ }
        decoder = null;
        decoderRef.current = null;
        if (!destroyed) {
          reconnectTimeout = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => { ws.close(); };
    }

    connect();

    return () => {
      destroyed = true;
      clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      try { decoder?.close(); } catch { /* ok */ }
      decoderRef.current = null;
      if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
    };
  }, [udid]);

  /* ── WS message sender ───────────────────────────────────────────────── */
  function sendWsMessage(msg: Record<string, unknown>) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }

  /* ── Coordinate helpers ──────────────────────────────────────────────── */
  function getCanvasRelativeCoords(e: ReactMouseEvent<HTMLDivElement>): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }

  /* ── Touch visual feedback ───────────────────────────────────────────── */
  function showTouchDot(e: ReactMouseEvent<HTMLDivElement>) {
    const dot = touchDotRef.current;
    const container = screenContainerRef.current;
    if (!dot || !container) return;
    const rect = container.getBoundingClientRect();
    dot.style.left = `${e.clientX - rect.left}px`;
    dot.style.top = `${e.clientY - rect.top}px`;
    dot.style.opacity = "1";
  }

  function hideTouchDot() {
    const dot = touchDotRef.current;
    if (dot) dot.style.opacity = "0";
  }

  /* ── Touch handlers (raw + UX gesture detection) ─────────────────────── */
  function handleMouseDown(e: ReactMouseEvent<HTMLDivElement>) {
    const coords = getCanvasRelativeCoords(e);
    if (!coords) return;
    touchActiveRef.current = true;
    dragStart.current = { x: coords.x, y: coords.y, time: Date.now() };
    showTouchDot(e);

    /* Send raw touch down */
    sendWsMessage({ type: "touch", action: "down", x: coords.x, y: coords.y });

    /* Long-press detection */
    longPressTimer.current = setTimeout(() => {
      if (dragStart.current) {
        sendWsMessage({ type: "longpress", x: dragStart.current.x, y: dragStart.current.y, duration: 1000 });
        dragStart.current = null;
      }
    }, 500);
  }

  function handleMouseMove(e: ReactMouseEvent<HTMLDivElement>) {
    if (!touchActiveRef.current) return;
    const now = Date.now();
    /* Throttle moves to ~60fps (16ms) */
    if (now - lastMoveRef.current < 16) return;
    lastMoveRef.current = now;

    const coords = getCanvasRelativeCoords(e);
    if (!coords) return;
    showTouchDot(e);

    /* Cancel long-press if finger moved significantly */
    if (longPressTimer.current && dragStart.current) {
      const dx = Math.abs(coords.x - dragStart.current.x);
      const dy = Math.abs(coords.y - dragStart.current.y);
      if (dx >= 0.02 || dy >= 0.02) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }

    sendWsMessage({ type: "touch", action: "move", x: coords.x, y: coords.y });
  }

  function handleMouseUp(e: ReactMouseEvent<HTMLDivElement>) {
    if (!touchActiveRef.current) return;
    touchActiveRef.current = false;
    hideTouchDot();

    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    const coords = getCanvasRelativeCoords(e);
    if (!coords) return;

    /* Send raw touch up */
    sendWsMessage({ type: "touch", action: "up", x: coords.x, y: coords.y });

    /* UX gesture detection — tap / swipe (on top of raw events) */
    if (dragStart.current) {
      const dx = Math.abs(coords.x - dragStart.current.x);
      const dy = Math.abs(coords.y - dragStart.current.y);
      const elapsed = Date.now() - dragStart.current.time;

      if (dx < 0.02 && dy < 0.02 && elapsed < 500) {
        sendWsMessage({ type: "tap", x: coords.x, y: coords.y });
      } else if (dx >= 0.02 || dy >= 0.02) {
        sendWsMessage({
          type: "swipe",
          x1: dragStart.current.x, y1: dragStart.current.y,
          x2: coords.x, y2: coords.y,
          duration: 300,
        });
      }
      dragStart.current = null;
    }
  }

  function handleMouseLeave() {
    if (touchActiveRef.current) {
      touchActiveRef.current = false;
      hideTouchDot();
      /* Send touch up at last known position */
      sendWsMessage({ type: "touch", action: "up", x: 0, y: 0 });
    }
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    dragStart.current = null;
  }

  /* ── Hardware keys ───────────────────────────────────────────────────── */
  function handleKey(name: string) {
    sendWsMessage({ type: "key", action: "down_and_up", keycode: name === "back" ? 4 : name === "home" ? 3 : name === "recent" ? 187 : name === "power" ? 26 : name === "volumeUp" ? 24 : name === "volumeDown" ? 25 : 0 });
    /* Also send legacy format for backwards compat */
    sendWsMessage({ type: "key", name });
  }

  function handleSendText() {
    if (!textInput.trim()) return;
    sendWsMessage({ type: "text", value: textInput });
    setTextInput("");
  }

  /* ── Compute canvas display dimensions ───────────────────────────────── */
  const canvasStyle: React.CSSProperties = {};
  if (videoSize.width > 0 && videoSize.height > 0) {
    canvasStyle.maxWidth = "100%";
    canvasStyle.maxHeight = "100%";
    canvasStyle.objectFit = "contain";
    canvasStyle.transform = `scale(${zoom / 100})`;
    canvasStyle.transformOrigin = "center center";
  }

  return (
    <div className="bg-bg-card border border-border-main rounded-xl overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-main bg-bg-subtle/50">
        <Smartphone className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        <span className="text-xs font-semibold text-text-main truncate flex-1">{model}</span>

        {/* Connection + FPS indicator */}
        <span className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-[10px] text-text-muted font-mono">
            {connected && hasFrame ? `${fps}fps` : "--"}
          </span>
        </span>

        {/* Zoom */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setZoom(z => Math.max(50, z - 25))}
            className="p-1 rounded hover:bg-bg-main/60 text-text-muted hover:text-text-main transition-colors"
            title="Уменьшить"
          >
            <Minimize2 className="w-3 h-3" />
          </button>
          <span className="text-[10px] text-text-muted w-8 text-center">{zoom}%</span>
          <button
            onClick={() => setZoom(z => Math.min(150, z + 25))}
            className="p-1 rounded hover:bg-bg-main/60 text-text-muted hover:text-text-main transition-colors"
            title="Увеличить"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>

        <button
          onClick={() => onClose(udid)}
          className="p-1 rounded hover:bg-red-50 text-text-muted hover:text-red-500 transition-colors flex-shrink-0"
          title="Закрыть"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Screen area */}
      <div
        ref={screenContainerRef}
        className="relative flex-1 bg-black flex items-center justify-center overflow-hidden cursor-crosshair select-none min-h-[320px]"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {hasFrame ? (
          <canvas
            ref={canvasRef}
            style={canvasStyle}
            className="transition-transform"
          />
        ) : (
          <>
            {/* Hidden canvas for when frames start arriving */}
            <canvas ref={canvasRef} style={{ display: "none" }} />
            <div className="text-center">
              {connected ? (
                <Loader2 className="w-6 h-6 text-gray-500 animate-spin mx-auto mb-2" />
              ) : (
                <WifiOff className="w-6 h-6 text-gray-500 mx-auto mb-2" />
              )}
              <p className="text-xs text-gray-500">
                {connected ? "Ожидание кадра..." : "Подключение..."}
              </p>
            </div>
          </>
        )}

        {/* Touch visual feedback dot */}
        <div
          ref={touchDotRef}
          className="pointer-events-none absolute w-4 h-4 -ml-2 -mt-2 rounded-full bg-white/50 border border-white/80 transition-opacity duration-150"
          style={{ opacity: 0 }}
        />
      </div>

      {/* Control bar */}
      <div className="flex items-center justify-center gap-1 px-3 py-2 border-t border-border-main bg-bg-subtle/50">
        <button onClick={() => handleKey("back")} className={BTN_GHOST + " px-2 py-1"} title="Назад">
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => handleKey("home")} className={BTN_GHOST + " px-2 py-1"} title="Домой">
          <Home className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => handleKey("recent")} className={BTN_GHOST + " px-2 py-1"} title="Недавние">
          <LayoutGrid className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-border-main mx-1" />
        <button onClick={() => handleKey("volumeUp")} className={BTN_GHOST + " px-2 py-1"} title="Громкость +">
          <Volume2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => handleKey("volumeDown")} className={BTN_GHOST + " px-2 py-1"} title="Громкость -">
          <VolumeX className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => handleKey("power")} className={BTN_GHOST + " px-2 py-1"} title="Питание">
          <Power className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Text input */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border-main">
        <Type className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        <input
          className={INPUT_CLS + " flex-1"}
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSendText(); }}
          placeholder="Ввести текст..."
        />
        <button
          onClick={handleSendText}
          disabled={!textInput.trim()}
          className="p-2 rounded-lg bg-primary text-white hover:bg-primary-dark
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ── Stats Bar ──────────────────────────────────────────────────────────── */

function StatsBar({ devices }: { devices: FarmDevice[] }) {
  const total = devices.length;
  const available = devices.filter(d => d.status === "AVAILABLE").length;
  const busy = devices.filter(d => d.status === "BUSY").length;
  const offline = devices.filter(d => d.status === "OFFLINE").length;

  return (
    <div className="flex items-center gap-4 text-xs">
      <span className="text-text-muted">
        Всего: <span className="font-semibold text-text-main">{total}</span>
      </span>
      <span className="text-green-600">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 mr-1" />
        Свободно: {available}
      </span>
      <span className="text-amber-600">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mr-1" />
        Занято: {busy}
      </span>
      <span className="text-gray-500">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 mr-1" />
        Офлайн: {offline}
      </span>
    </div>
  );
}

/* ── Sessions Table ─────────────────────────────────────────────────────── */

function SessionsTable({
  sessions, onForceRelease, releasing,
}: {
  sessions: FarmSession[];
  onForceRelease: (id: string) => void;
  releasing: string | null;
}) {
  if (sessions.length === 0) {
    return (
      <div className="text-center py-12">
        <Clock className="w-10 h-10 text-text-muted/40 mx-auto mb-3" />
        <p className="text-sm text-text-muted">Нет активных сессий</p>
      </div>
    );
  }

  return (
    <div className="border border-border-main rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-bg-subtle/80 border-b border-border-main">
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-muted">Устройство</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-muted">Пользователь</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-muted">Тип</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-muted">Начало</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-muted">Длительность</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-muted">Статус</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold text-text-muted">Действия</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-main">
          {sessions.map((s) => (
            <tr key={s.id} className="hover:bg-bg-subtle/30 transition-colors">
              <td className="px-4 py-2.5">
                <span className="font-mono text-xs text-text-main">{s.deviceUdid.slice(0, 12)}...</span>
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <User className="w-3 h-3 text-text-muted" />
                  <span className="text-text-main">{s.username || s.userId}</span>
                </div>
              </td>
              <td className="px-4 py-2.5">
                <span className={`${BADGE_CLS} ${
                  s.type === "MANUAL"
                    ? "bg-blue-50 text-blue-700"
                    : "bg-purple-50 text-purple-700"
                }`}>
                  {s.type === "MANUAL" ? "Ручной" : "Автоматизация"}
                </span>
              </td>
              <td className="px-4 py-2.5 text-text-muted">{formatTime(s.startedAt)}</td>
              <td className="px-4 py-2.5 text-text-main">{formatDuration(s.startedAt, s.endedAt)}</td>
              <td className="px-4 py-2.5">
                <span className={`${BADGE_CLS} ${
                  s.status === "active"
                    ? "bg-green-50 text-green-700"
                    : s.status === "expired"
                    ? "bg-red-50 text-red-700"
                    : "bg-gray-100 text-gray-600"
                }`}>
                  {s.status === "active" ? "Активна" : s.status === "expired" ? "Истекла" : s.status}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right">
                {s.status === "active" && (
                  <button
                    onClick={() => onForceRelease(s.id)}
                    disabled={releasing === s.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium
                      rounded-lg border border-red-200 text-red-600 hover:bg-red-50
                      disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {releasing === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    Принудительно завершить
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────────────────────── */

export default function DeviceFarmSection() {
  const [activeTab, setActiveTab] = useState<TabId>("devices");
  const [devices, setDevices] = useState<FarmDevice[]>([]);
  const [sessions, setSessions] = useState<FarmSession[]>([]);
  const [workspaceDevices, setWorkspaceDevices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [locking, setLocking] = useState<string | null>(null);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [workspaceCols, setWorkspaceCols] = useState(1);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  // Polling interval ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load devices
  const loadDevices = useCallback(async () => {
    try {
      const devs = await getFarmDevices();
      setDevices(devs);
      setConnected(true);
      setError("");
    } catch (e) {
      setConnected(false);
      if (loading) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, [loading]);

  // Load sessions
  const loadSessions = useCallback(async () => {
    try {
      const sess = await getFarmSessions();
      setSessions(sess);
    } catch {
      // Silent fail for sessions
    }
  }, []);

  // Initial load + polling
  useEffect(() => {
    loadDevices();
    loadSessions();

    pollRef.current = setInterval(() => {
      loadDevices();
      if (activeTab === "sessions") loadSessions();
    }, 10000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadDevices, loadSessions, activeTab]);

  // Handlers
  async function handleLock(udid: string) {
    setLocking(udid);
    try {
      await lockFarmDevice(udid);
      await loadDevices();
      // Auto-open on workspace
      setWorkspaceDevices((prev) => prev.includes(udid) ? prev : [...prev, udid]);
      setActiveTab("workspace");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLocking(null);
    }
  }

  async function handleUnlock(udid: string) {
    setLocking(udid);
    try {
      await unlockFarmDevice(udid);
      setWorkspaceDevices((prev) => prev.filter(id => id !== udid));
      await loadDevices();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLocking(null);
    }
  }

  function handleOpenWorkspace(udid: string) {
    setWorkspaceDevices((prev) => prev.includes(udid) ? prev : [...prev, udid]);
    setActiveTab("workspace");
  }

  function handleClosePanel(udid: string) {
    setWorkspaceDevices((prev) => prev.filter(id => id !== udid));
  }

  async function handleForceRelease(sessionId: string) {
    setReleasing(sessionId);
    try {
      await forceReleaseFarmSession(sessionId);
      await loadSessions();
      await loadDevices();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReleasing(null);
    }
  }

  // Filter devices
  const filteredDevices = devices.filter((d) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!d.model.toLowerCase().includes(q) && !d.udid.toLowerCase().includes(q) && !d.osVersion.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (platformFilter && d.platform !== platformFilter) return false;
    if (statusFilter && d.status !== statusFilter) return false;
    return true;
  });

  // Not configured state
  const notConfigured = !loading && !connected && devices.length === 0;

  if (notConfigured && error) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <Smartphone className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-bold text-text-main">Ферма устройств</h1>
        </div>
        <div className="bg-bg-card border border-border-main rounded-xl p-8 text-center max-w-lg mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-primary/5 flex items-center justify-center mx-auto mb-4">
            <Smartphone className="w-7 h-7 text-text-muted/40" />
          </div>
          <h2 className="text-base font-semibold text-text-main mb-2">Ферма устройств не настроена</h2>
          <p className="text-sm text-text-muted mb-4">
            Перейдите в Настройки и включите ферму устройств для управления мобильными устройствами.
          </p>
          <a
            href="/settings"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
              bg-primary text-white hover:bg-primary-dark transition-colors"
          >
            <Settings className="w-4 h-4" />
            Открыть настройки
          </a>
        </div>
      </div>
    );
  }

  const TABS: { id: TabId; label: string; icon: typeof Smartphone; count?: number }[] = [
    { id: "devices", label: "Устройства", icon: Smartphone },
    { id: "workspace", label: "Рабочий стол", icon: MonitorSmartphone, count: workspaceDevices.length },
    { id: "sessions", label: "Сессии", icon: Clock },
  ];

  return (
    <div className="p-6 space-y-4 overflow-y-auto scrollbar-thin h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-bold text-text-main">Ферма устройств</h1>
          <span className={`${BADGE_CLS} ${connected ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {connected ? "Подключено" : "Нет связи"}
          </span>
        </div>
        <button
          onClick={() => { loadDevices(); loadSessions(); }}
          className={BTN_GHOST}
          title="Обновить"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Обновить
        </button>
      </div>

      {/* Error banner */}
      {error && connected && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border-main">
        {TABS.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            onClick={() => {
              setActiveTab(id);
              if (id === "sessions") loadSessions();
            }}
            className={`
              flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors
              ${activeTab === id
                ? "border-primary text-primary"
                : "border-transparent text-text-muted hover:text-text-main hover:border-border-main"}
            `}
          >
            <Icon className="w-4 h-4" />
            {label}
            {count !== undefined && count > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-primary/10 text-primary">
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-text-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-primary" /> Загрузка устройств...
        </div>
      )}

      {/* ── Tab: Devices ──────────────────────────────────────────────────── */}
      {!loading && activeTab === "devices" && (
        <div className="space-y-4">
          {/* Stats */}
          <StatsBar devices={devices} />

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                className={INPUT_CLS + " pl-9"}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск по модели, UDID..."
              />
            </div>
            <select
              className={SELECT_CLS + " min-w-[140px]"}
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
            >
              <option value="">Все платформы</option>
              <option value="ANDROID">Android</option>
              <option value="IOS">iOS</option>
            </select>
            <select
              className={SELECT_CLS + " min-w-[140px]"}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Все статусы</option>
              <option value="AVAILABLE">Свободен</option>
              <option value="BUSY">Занят</option>
              <option value="OFFLINE">Офлайн</option>
              <option value="MAINTENANCE">Обслуживание</option>
            </select>
          </div>

          {/* Device grid */}
          {filteredDevices.length === 0 ? (
            <div className="text-center py-12">
              <Smartphone className="w-10 h-10 text-text-muted/40 mx-auto mb-3" />
              <p className="text-sm text-text-muted">
                {devices.length === 0
                  ? "Нет подключенных устройств"
                  : "Нет устройств, соответствующих фильтрам"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredDevices.map((device) => (
                <DeviceCard
                  key={device.udid}
                  device={device}
                  onLock={handleLock}
                  onUnlock={handleUnlock}
                  onOpenWorkspace={handleOpenWorkspace}
                  locking={locking}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Workspace ────────────────────────────────────────────────── */}
      {!loading && activeTab === "workspace" && (
        <div className="space-y-4">
          {/* Layout selector */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-muted">
              {workspaceDevices.length === 0
                ? "Нет открытых устройств. Захватите устройство на вкладке \"Устройства\"."
                : `Открыто устройств: ${workspaceDevices.length}`}
            </p>
            {workspaceDevices.length > 0 && (
              <div className="flex items-center gap-1 bg-bg-subtle rounded-lg p-1">
                <button
                  onClick={() => setWorkspaceCols(1)}
                  className={`p-1.5 rounded ${workspaceCols === 1 ? "bg-bg-card shadow-sm" : "hover:bg-bg-main/60"} transition-colors`}
                  title="1 колонка"
                >
                  <Square className="w-3.5 h-3.5 text-text-muted" />
                </button>
                <button
                  onClick={() => setWorkspaceCols(2)}
                  className={`p-1.5 rounded ${workspaceCols === 2 ? "bg-bg-card shadow-sm" : "hover:bg-bg-main/60"} transition-colors`}
                  title="2 колонки"
                >
                  <Columns2 className="w-3.5 h-3.5 text-text-muted" />
                </button>
                <button
                  onClick={() => setWorkspaceCols(3)}
                  className={`p-1.5 rounded ${workspaceCols === 3 ? "bg-bg-card shadow-sm" : "hover:bg-bg-main/60"} transition-colors`}
                  title="3 колонки"
                >
                  <Columns3 className="w-3.5 h-3.5 text-text-muted" />
                </button>
              </div>
            )}
          </div>

          {/* Panels grid */}
          {workspaceDevices.length === 0 ? (
            <div className="text-center py-12">
              <MonitorSmartphone className="w-10 h-10 text-text-muted/40 mx-auto mb-3" />
              <p className="text-sm text-text-muted">Захватите устройство, чтобы начать работу</p>
            </div>
          ) : (
            <div
              className="grid gap-4"
              style={{
                gridTemplateColumns: `repeat(${Math.min(workspaceCols, workspaceDevices.length)}, minmax(0, 1fr))`,
              }}
            >
              {workspaceDevices.map((udid) => {
                const device = devices.find(d => d.udid === udid);
                return (
                  <DevicePanel
                    key={udid}
                    udid={udid}
                    model={device?.model ?? udid}
                    platform={device?.platform ?? "ANDROID"}
                    onClose={handleClosePanel}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Sessions ─────────────────────────────────────────────────── */}
      {!loading && activeTab === "sessions" && (
        <SessionsTable
          sessions={sessions}
          onForceRelease={handleForceRelease}
          releasing={releasing}
        />
      )}
    </div>
  );
}
