"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Play, Save } from "lucide-react";
import { Badge, Button, Input, Label, Modal } from "@/components/ui";
import { clearPvsCredentials, getPvsSettings, savePvsCredentials, testPvsConnection, type PvsSettings } from "@/lib/mcpLogsApi";

const CREDENTIAL_STATUS = {
  saved: "Используется учётная запись, сохранённая в Shark.",
  environment: "Используется учётная запись из окружения сервера.",
  none: "Пароль не задан.",
  unavailable: "Не удалось прочитать учётную запись. Введите логин и пароль заново.",
};

function PvsForm() {
  const formId = useId();
  const [settings, setSettings] = useState<PvsSettings | null>(null);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<"load" | "save" | "test" | "clear" | null>("load");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const testing = useRef<AbortController | null>(null);

  function apply(data: PvsSettings) {
    setSettings(data);
    setLogin(data.login || "pvs_user");
    setPassword("");
  }

  useEffect(() => {
    getPvsSettings().then(apply, error => setFeedback({ ok: false, text: error.message })).finally(() => setPending(null));
    return () => testing.current?.abort();
  }, []);

  async function action(kind: "save" | "test" | "clear", run: () => Promise<string>) {
    setPending(kind);
    setFeedback(null);
    try {
      setFeedback({ ok: true, text: await run() });
    } catch (error) {
      setFeedback({ ok: false, text: (error as Error).message });
    } finally {
      setPending(null);
    }
  }

  const changed = !!settings && (!!password || login !== (settings.login || "pvs_user"));

  return (
    <form className="space-y-4" aria-busy={!!pending} onSubmit={event => {
      event.preventDefault();
      if (!pending && login.trim() && password) void action("save", async () => {
        apply(await savePvsCredentials(login.trim(), password));
        return "Учётная запись сохранена.";
      });
    }}>
      {settings && <>
        <dl className="grid gap-3 rounded-lg border border-border-main bg-bg-subtle p-3 text-sm sm:grid-cols-2">
          <div className="sm:col-span-2"><dt className="text-xs text-text-muted">API PVS</dt>
            <dd className="break-all font-mono text-xs">{settings.apiUrl || "Адрес задаётся на сервере"}</dd></div>
          <div><dt className="text-xs text-text-muted">Namespace</dt><dd className="break-all">{settings.namespace || "Не задан"}</dd></div>
          <div><dt className="text-xs text-text-muted">Индекс</dt><dd className="break-all">{settings.index || "Не задан"}</dd></div>
        </dl>
        {settings.demo ? <Badge>Демо-режим</Badge>
          : !settings.launchConfigured && <p className="tone-warning rounded-lg border px-3 py-2 text-xs">
            ГигаКод должен установить PVS MCP и задать индекс по инструкции <code>docs/pvs-mcp.md</code> на сервере Shark.
          </p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${formId}-login`}>Логин PVS</Label>
            <Input id={`${formId}-login`} value={login} maxLength={200} required disabled={!!pending} autoComplete="off"
              onChange={event => setLogin(event.target.value)} />
          </div>
          <div>
            <Label htmlFor={`${formId}-password`}>Пароль PVS</Label>
            <Input id={`${formId}-password`} type="password" value={password} maxLength={4096} disabled={!!pending} autoComplete="new-password"
              placeholder={settings.credentialSource === "saved" ? "Сохранён · введите новый" : "Введите пароль"}
              onChange={event => setPassword(event.target.value)} />
          </div>
        </div>
        <p className="text-xs text-text-muted">{CREDENTIAL_STATUS[settings.credentialSource]} Чтобы сменить логин, укажите пароль.</p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {(settings.credentialSource === "saved" || settings.credentialSource === "unavailable") && <Button
            type="button" variant="danger" className="mr-auto" disabled={!!pending} loading={pending === "clear"}
            onClick={() => void action("clear", async () => {
              apply(await clearPvsCredentials());
              return "Учётная запись удалена из настроек Shark.";
            })}>
            Убрать сохранённую учётку
          </Button>}
          <Button type="button" variant="ghost" loading={pending === "test"}
            disabled={!!pending || changed || (!settings.demo && !settings.launchConfigured)}
            icon={<Play className="h-3.5 w-3.5" aria-hidden />}
            onClick={() => void action("test", async () => {
              const controller = new AbortController();
              testing.current = controller;
              try {
                return (await testPvsConnection({ signal: controller.signal, onProgress: () => {} })).message;
              } finally {
                testing.current = null;
              }
            })}>
            Проверить подключение
          </Button>
          <Button type="submit" loading={pending === "save"} icon={<Save className="h-3.5 w-3.5" aria-hidden />}
            disabled={!!pending || !login.trim() || !password}>Сохранить</Button>
        </div>
      </>}
      {pending === "load" && <p role="status" className="flex items-center gap-2 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Загрузка настроек…
      </p>}
      {feedback && <p role={feedback.ok ? "status" : "alert"} className={`rounded-lg border px-3 py-2 text-sm ${feedback.ok ? "tone-success" : "tone-danger"}`}>
        {feedback.text}
      </p>}
    </form>
  );
}

export default function PvsSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Modal open={open} onClose={onClose} title="PVS MCP · подключение логов" size="max-w-xl" minimizable={false}>
    {open && <PvsForm />}
  </Modal>;
}
