import type { MouseEvent } from "react";

/**
 * Закрытие окна щелчком по затемнению — только если и нажатие, и отпускание кнопки мыши были на затемнении.
 * Иначе выделение текста в поле окна, отпущенное за его краем, закрывало окно: браузер шлёт click общему
 * предку точек нажатия и отпускания — затемнению. Флаг нажатия хранится в data-атрибуте элемента — без хуков,
 * можно вешать и на окна внутри больших разделов.
 */
export function backdropClose(close: () => void) {
  return {
    onMouseDown: (e: MouseEvent<HTMLElement>) => { e.currentTarget.dataset.downOnBackdrop = e.target === e.currentTarget ? "1" : ""; },
    onClick: (e: MouseEvent<HTMLElement>) => {
      const started = e.currentTarget.dataset.downOnBackdrop === "1";
      e.currentTarget.dataset.downOnBackdrop = "";
      if (started && e.target === e.currentTarget) close();
    },
  };
}
