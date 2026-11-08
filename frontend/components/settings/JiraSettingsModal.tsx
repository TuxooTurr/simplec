"use client";

import { Modal } from "@/components/ui";
import JiraSettingsBlock from "@/components/JiraSettingsBlock";

/** Подключение к Jira — открывается из настроек и разделов. Маркер Jira выпускается сам при входе в Shark логином Jira. */
export default function JiraSettingsModal({ open, onClose }: {
  open: boolean; onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Подключение к Jira" size="max-w-xl">
      <JiraSettingsBlock />
    </Modal>
  );
}
