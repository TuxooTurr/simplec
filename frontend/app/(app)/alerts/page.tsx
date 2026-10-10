import { redirect } from "next/navigation";

// Генератор алертов переехал в «Генераторы событий»: каждая папка алертов —
// отдельная плитка. Старые ссылки ведут в хаб.
export default function Page() {
  redirect("/event-generators");
}
