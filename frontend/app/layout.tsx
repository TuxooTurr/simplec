import type { Metadata } from "next";
import "./globals.css";
import WorkspaceShell from "@/components/WorkspaceShell";

export const metadata: Metadata = {
  title: "SimpleTest — AI-генератор тест-кейсов",
  description: "Превращает требования в тест-кейсы для Jira Zephyr Scale",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <WorkspaceShell>{children}</WorkspaceShell>
      </body>
    </html>
  );
}
