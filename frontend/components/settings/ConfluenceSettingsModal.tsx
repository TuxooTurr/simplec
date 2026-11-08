"use client";

import { Modal } from "@/components/ui";
import ConfluenceSettingsBlock from "@/components/ConfluenceSettingsBlock";

/** Подключение к Confluence — из настроек, «Графика стендов» и «Данных». Маркер выпускается сам при входе в Shark логином Jira. */
export default function ConfluenceSettingsModal({ open, onClose, title = "Подключение к Confluence" }: {
  open: boolean; onClose: () => void; title?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="max-w-xl">
      <ConfluenceSettingsBlock />
    </Modal>
  );
}
