"use client";

import DataDocs from "@/components/data/DataDocs";

/**
 * Раздел «Данные»: дерево документов на всю рабочую область.
 * Имя файла и id раздела «etalons» исторические — на них завязаны маршрут /etalons,
 * сохранённые раскладки рабочих зон и резервные копии. Прежние эталоны (RAG) упразднены.
 */
export default function EtalonsSection() {
  return <DataDocs />;
}
