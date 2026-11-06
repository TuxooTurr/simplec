/**
 * Формы, которые живут выше раздела: их можно свернуть и уйти на другую вкладку — форма, её генерация и отправка в Jira
 * продолжаются. Показывает их FormHost в оболочке приложения.
 *
 * render получает FormControl и замыкает всё остальное из того места, где форму открыли.
 */

import { useSyncExternalStore, type ReactNode } from "react";

export interface FormControl {
  minimized: boolean;
  minimize: () => void;
  restore: () => void;
  close: () => void;
}
export interface HostedForm { id: number; minimized: boolean; render: (c: FormControl) => ReactNode }

let forms: HostedForm[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const set = (next: HostedForm[]) => { forms = next; listeners.forEach(l => l()); };

export function openForm(render: HostedForm["render"]): void {
  set([...forms, { id: ++seq, minimized: false, render }]);
}
export const closeForm = (id: number) => set(forms.filter(f => f.id !== id));
export const setFormMinimized = (id: number, minimized: boolean) =>
  set(forms.map(f => (f.id === id ? { ...f, minimized } : f)));

/** Открыта ли форма на экране: горячие клавиши раздела в это время молчат. */
export const anyFormOnScreen = () => forms.some(f => !f.minimized);

const EMPTY: HostedForm[] = [];
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useForms = () => useSyncExternalStore(subscribe, () => forms, () => EMPTY);
