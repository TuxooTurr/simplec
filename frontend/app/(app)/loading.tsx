import { SharkLoader } from "@/components/ui/RefreshButton";

/** Переход между разделами: рабочая зона показывает акулу, пока грузится страница раздела. */
export default function Loading() {
  return <SharkLoader size={36} label="Загрузка раздела" className="min-h-[200px]" />;
}
