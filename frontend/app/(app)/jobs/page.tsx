import { redirect } from "next/navigation";

// Jobs переехали в «Генераторы событий» плиткой. Старые ссылки открывают её сразу.
export default function Page() {
  redirect("/event-generators?open=jobs");
}
