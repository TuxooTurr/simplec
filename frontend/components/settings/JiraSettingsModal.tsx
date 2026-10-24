"use client";

import { useState } from "react";
import { Modal } from "@/components/ui";
import JiraSettingsBlock from "@/components/JiraSettingsBlock";
import CorpAccountBlock from "@/components/settings/CorpAccountBlock";

/** Подключение к Jira — открывается прямо из раздела дефектов; сверху — единый вход сразу в Jira и Confluence. */
export default function JiraSettingsModal({ open, onClose }: {
  open: boolean; onClose: () => void;
}) {
  const [k, setK] = useState(0);   // после единого входа — перечитать настройки ниже (маркер появился)
  return (
    <Modal open={open} onClose={onClose} title="Подключение к Jira" size="max-w-xl">
      <div className="space-y-5">
        <CorpAccountBlock onDone={() => setK(x => x + 1)} />
        <JiraSettingsBlock key={k} />
      </div>
    </Modal>
  );
}
