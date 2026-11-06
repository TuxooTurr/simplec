"use client";

import { Fragment } from "react";
import { closeForm, setFormMinimized, useForms } from "@/lib/backgroundForms";

export const FORM_DOCK_ID = "form-dock";

/** Формы поверх всех разделов и полка свёрнутых внизу справа: переход между разделами их не закрывает. */
export default function FormHost() {
  const forms = useForms();
  return (
    <>
      <div id={FORM_DOCK_ID} className="fixed bottom-4 right-4 z-40 flex max-w-sm flex-col items-end gap-2" />
      {forms.map(f => (
        <Fragment key={f.id}>
          {f.render({
            minimized: f.minimized, minimize: () => setFormMinimized(f.id, true),
            restore: () => setFormMinimized(f.id, false), close: () => closeForm(f.id),
          })}
        </Fragment>
      ))}
    </>
  );
}
