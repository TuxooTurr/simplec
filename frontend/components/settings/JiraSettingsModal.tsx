"use client";

import { Modal } from "@/components/ui";
import JiraSettingsBlock from "@/components/JiraSettingsBlock";

/** Подключение к Jira — открывается прямо из раздела дефектов. */
export default function JiraSettingsModal({ open, onClose }: {
  open: boolean; onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Дефекты — подключение к Jira" size="max-w-xl">
      <JiraSettingsBlock />
    </Modal>
  );
}
