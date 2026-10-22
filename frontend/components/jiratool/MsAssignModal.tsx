"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import ServicePicker from "@/components/stands/ServicePicker";
import type { ReqAssignMode } from "./ReqAssignModal";

/**
 * Микросервисы для выбранных задач — как «Требования…»: выберите микросервисы из общего справочника (поиск по имени
 * и описанию; нет нужного — «+ Создать», сохранится в справочник у всех) и что сделать — добавить к уже указанным,
 * заменить ими или снять. Микросервисы хранятся у задачи (общие на все списки).
 */
export default function MsAssignModal({ open, count, catalog, info, onCreate, onApply, onClose }: {
  open: boolean;
  /** Сколько задач выбрано. */
  count: number;
  catalog: string[];
  info: Record<string, string>;
  onCreate: (names: string[]) => Promise<void>;
  onApply: (names: string[], mode: ReqAssignMode) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const apply = (mode: ReqAssignMode) => { onApply(picked, mode); onClose(); };
  const btn = "px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-40";

  return (
    <Modal open={open} onClose={onClose} title={`Микросервисы для выбранных задач: ${count}`} size="max-w-xl">
      <div className="space-y-3">
        <ServicePicker value={picked} onChange={setPicked} catalog={catalog} info={info} onCreate={onCreate} autoFocus inlineList
          placeholder={catalog.length ? "найти по имени или описанию; нет нужного — создать" : "имя микросервиса"} className="w-full" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-muted">Выбрано: {picked.length}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" disabled={!picked.length} onClick={() => apply("remove")}
              className={`${btn} border border-border-main text-text-muted hover:text-red-500 font-normal`}>Снять у выбранных</button>
            <button type="button" disabled={!picked.length} onClick={() => apply("replace")}
              className={`${btn} border border-border-main text-text-main font-normal`}>Заменить</button>
            <button type="button" disabled={!picked.length} onClick={() => apply("add")}
              className={`${btn} bg-primary text-white`}>Добавить</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
