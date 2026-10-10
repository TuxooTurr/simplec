import { redirect } from "next/navigation";

// Раздел «Автотестирование» скрыт: код раздела (AutoModelSection) сохранён,
// вернуть — восстановить рендер секции здесь и пункт в Sidebar.
export default function Page() {
  redirect("/generation");
}
