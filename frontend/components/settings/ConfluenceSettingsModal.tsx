"use client";

import { useState } from "react";
import { Modal } from "@/components/ui";
import ConfluenceSettingsBlock from "@/components/ConfluenceSettingsBlock";
import CorpAccountBlock from "@/components/settings/CorpAccountBlock";

/** Подключение к Confluence — из «Графика стендов» и «Данных»; сверху — единый вход сразу в Jira и Confluence. */
export default function ConfluenceSettingsModal({ open, onClose, title = "Подключение к Confluence" }: {
  open: boolean; onClose: () => void; title?: string;
}) {
  const [k, setK] = useState(0);   // после единого входа — перечитать настройки ниже (маркер появился)
  return (
    <Modal open={open} onClose={onClose} title={title} size="max-w-xl">
      <div className="space-y-5">
        <CorpAccountBlock onDone={() => setK(x => x + 1)} />
        <ConfluenceSettingsBlock key={k} />
      </div>
    </Modal>
  );
}
