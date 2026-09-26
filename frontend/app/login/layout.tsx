import type { Metadata } from "next";

// Страница входа — клиентский компонент и не может экспортировать metadata сама.
export const metadata: Metadata = { title: "Вход" };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
