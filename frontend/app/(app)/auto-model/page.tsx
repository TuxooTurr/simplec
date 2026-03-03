import { FlaskConical } from "lucide-react";

export default function AutoModelPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-5 p-8 text-center animate-fade-in">
      <div className="w-16 h-16 rounded-2xl bg-violet-50 flex items-center justify-center">
        <FlaskConical className="w-8 h-8 text-violet-400" strokeWidth={1.5} />
      </div>
      <div>
        <h1 className="text-xl font-bold text-text-main mb-2">Авто тестовая модель</h1>
        <p className="text-sm text-text-muted max-w-sm">
          Автоматическая генерация тест-кейсов на основе эталонных пар XML→Java.
          Раздел находится в разработке.
        </p>
      </div>
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-100 text-violet-600 text-xs font-semibold">
        <FlaskConical className="w-3.5 h-3.5" />
        В разработке
      </span>
    </div>
  );
}
