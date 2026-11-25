"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { getPixso, savePixso } from "@/lib/pixso";

export default function PixsoSettingsModal({ onClose }: { onClose: () => void }) {
  const [configured, setConfigured] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void getPixso().then(r => setConfigured(r.configured), e => setError(e.message)); }, []);
  const save = async (value: string) => {
    setBusy(true); setError("");
    try { const result = await savePixso(value); setConfigured(result.configured); setToken(""); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <Modal open title="Pixso MCP" onClose={onClose}
    footer={<div className="flex justify-end gap-2">
      {configured && <Button variant="ghost" disabled={busy} onClick={() => void save("")}>Удалить мой токен</Button>}
      <Button loading={busy} disabled={!token.trim()} onClick={() => void save(token)}>Сохранить токен</Button>
    </div>}>
    <div className="space-y-3">
      <p role="status" className="text-sm text-text-muted">{configured ? "Токен настроен. Доступ к каждому макету проверяется при чтении." : "Добавьте Access Token из профиля Pixso."}</p>
      <label className="block text-sm">Access Token
        <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border-main bg-bg-card px-3 py-2" />
      </label>
      {error && <p role="alert" className="text-sm tone-danger">{error}</p>}
    </div>
  </Modal>;
}
