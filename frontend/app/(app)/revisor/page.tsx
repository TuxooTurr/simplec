import { redirect } from "next/navigation";

// Раздел «Ревизор» упразднён до доработки через локальный MCP web (доступа к
// API стендов нет). Код раздела (RevisorSection) сохранён.
export default function Page() {
  redirect("/generation");
}
