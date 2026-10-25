"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ImageOff } from "lucide-react";
import { authHeaders } from "@/lib/authApi";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * Картинка в документе. Свои (/api/…: рисунки «Данных», картинки Confluence в предпросмотре) отдаются только с входом,
 * поэтому грузятся запросом с маркером и показываются из памяти; внешние — как обычно. Щелчок — во весь экран.
 */
export default function AuthImage({ src, alt }: { src: string; alt: string }) {
  const own = src.startsWith("/api/");
  const [url, setUrl] = useState<string | null>(own ? null : src);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    if (!own) { setUrl(src); return; }
    let alive = true;
    let made = "";
    setFailed(false); setUrl(null);
    fetch(`${API_BASE}${src}`, { headers: authHeaders() })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then(b => { if (alive) { made = URL.createObjectURL(b); setUrl(made); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [src, own]);

  if (failed) return (
    <span className="inline-flex items-center gap-1 rounded border border-dashed border-border-main px-2 py-1 text-xs text-text-muted">
      <ImageOff className="w-3.5 h-3.5" /> {alt || "изображение"} — не загрузилось
    </span>
  );
  if (!url) return <span className="inline-block h-24 w-40 animate-pulse rounded-lg bg-bg-subtle align-middle" aria-label={alt} />;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} title={alt || undefined} onClick={() => setZoom(true)} onError={() => setFailed(true)}
        className="inline-block max-w-full max-h-[480px] rounded-lg border border-border-main bg-white cursor-zoom-in align-middle" />
      {zoom && typeof document !== "undefined" && createPortal(
        <div role="dialog" aria-label={alt || "Изображение"} onClick={() => setZoom(false)}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6 cursor-zoom-out">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={alt} className="max-h-full max-w-full rounded-lg bg-white" />
        </div>, document.body)}
    </>
  );
}
