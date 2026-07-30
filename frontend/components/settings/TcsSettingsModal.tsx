"use client";

import { Modal } from "@/components/ui";
import TcsConfigPanel from "@/components/sections/TcsConfigPanel";

/** Настройки сценария ТКС (база, схема, таблицы) прямо из раздела-генератора. */
export default function TcsSettingsModal({ open, onClose }: {
  open: boolean; onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="ТКС — схема и таблицы" size="max-w-2xl">
      <TcsConfigPanel />
    </Modal>
  );
}
