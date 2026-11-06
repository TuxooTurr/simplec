/**
 * Слежение за запуском Jenkins, не привязанное к окну: закрыли окно запуска, ушли в другой раздел — очередь и сборка
 * отслеживаются дальше, итог приходит уведомлением. Живёт, пока открыта вкладка браузера.
 */

import { getJenkinsJob, getJenkinsQueue, type JenkinsQueue } from "./aqaApi";
import { notify } from "./notifications";

const QUEUE_POLL_MS = 2500, BUILD_POLL_MS = 30_000;
const QUEUE_LIMIT_MS = 30 * 60_000, BUILD_LIMIT_MS = 12 * 60 * 60_000;
const MAX_FAILS = 20;                           // сеть пропала надолго — перестаём спрашивать

const pause = (ms: number) => new Promise(r => window.setTimeout(r, ms));
const RESULT: Record<string, string> = { SUCCESS: "успешно", FAILURE: "упала", UNSTABLE: "нестабильна", ABORTED: "прервана" };

async function watchBuild(job: string, number: number, url: string, onChange: () => void) {
  const until = Date.now() + BUILD_LIMIT_MS;
  let fails = 0;
  while (Date.now() < until && fails < MAX_FAILS) {
    await pause(BUILD_POLL_MS);
    try {
      const b = (await getJenkinsJob()).builds.find(x => x.number === number);
      fails = 0;
      if (b && b.result === "RUNNING") { onChange(); continue; }
      onChange();
      if (!b) return;                           // сборка вне списка последних — итога уже не узнать
      notify({
        kind: b.result === "SUCCESS" ? "success" : b.result === "ABORTED" ? "info" : "error",
        title: `Автотесты ${job} #${number}: ${RESULT[b.result] ?? b.result}`, links: [{ label: `Сборка #${number}`, href: url }],
      });
      return;
    } catch { fails++; }
  }
}

/** onUpdate — состояние очереди для окна запуска (окна может уже не быть — тогда вызов ни на что не влияет). */
export async function watchJenkinsRun(queueId: number, job: string, onUpdate: (q: JenkinsQueue) => void, onChange: () => void, isOpen: () => boolean) {
  const until = Date.now() + QUEUE_LIMIT_MS;
  let fails = 0;
  while (Date.now() < until && fails < MAX_FAILS) {
    await pause(QUEUE_POLL_MS);
    let q: JenkinsQueue;
    try { q = await getJenkinsQueue(queueId); fails = 0; } catch { fails++; continue; }
    onUpdate(q);
    if (q.state === "queued") continue;
    onChange();
    if (q.state === "cancelled") notify({ kind: "error", title: `Запуск ${job} отменён в очереди Jenkins`, silent: isOpen() });
    if (q.state === "started" && q.number) {
      notify({ kind: "info", title: `Автотесты ${job}: запущена сборка #${q.number}`, links: [{ label: `Сборка #${q.number}`, href: q.url ?? "" }], silent: isOpen() });
      await watchBuild(job, q.number, q.url ?? "", onChange);
    }
    return;
  }
  onUpdate({ state: "slow" });
}
