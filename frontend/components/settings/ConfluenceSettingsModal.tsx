"use client";

import { Modal } from "@/components/ui";
import ConfluenceSettingsBlock from "@/components/ConfluenceSettingsBlock";

/** Подключение к Confluence — открывается прямо из раздела «График стендов», как настройки Jira в Jira tool. */
export default function ConfluenceSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="График стендов — подключение к Confluence" size="max-w-xl">
      <ConfluenceSettingsBlock />
    </Modal>
  );
}
