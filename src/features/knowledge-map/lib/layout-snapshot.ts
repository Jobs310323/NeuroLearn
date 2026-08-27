import type { Positioned } from './compute-layout';

/**
 * Снимок раскладки для одного шага «Отменить».
 *
 * Один шаг, а не история: «Упорядочить» — это одно решение, и отменяют его
 * сразу после нажатия, увидев результат. Глубокая история потребовала бы
 * хранилища и синхронизации между устройствами ради сценария, которого нет.
 *
 * Снимок живёт в памяти вкладки: перезагрузка его теряет — и это честно
 * названо в интерфейсе («Отменить» просто пропадает). Держать его в базе
 * значило бы обещать вечную обратимость, которой у одной кнопки не бывает.
 */

export type LayoutSnapshot = {
  positions: Positioned[];
  /** Версия раскладки ДО применения — с ней и возвращаемся. */
  layoutVersion: number;
  takenAt: number;
  /** Что именно отменяем — показывается на кнопке. */
  label: string;
};

export function takeSnapshot(
  positions: Positioned[],
  layoutVersion: number,
  label: string,
  now = Date.now(),
): LayoutSnapshot {
  return {
    // Копия, а не ссылка: массив узлов карты мутируется при перетаскивании,
    // и снимок «до» иначе тихо превратился бы в снимок «после».
    positions: positions.map((p) => ({ ...p })),
    layoutVersion,
    takenAt: now,
    label,
  };
}

/**
 * Снимок протухает: отменять раскладку через полчаса работы с картой —
 * значит откатывать и всё ручное перетаскивание, сделанное за это время.
 */
export const SNAPSHOT_TTL_MS = 5 * 60_000;

export function isSnapshotUsable(
  snapshot: LayoutSnapshot | null,
  now = Date.now(),
): snapshot is LayoutSnapshot {
  return snapshot !== null && now - snapshot.takenAt <= SNAPSHOT_TTL_MS;
}

/** Изменились ли позиции по существу (целочисленное сравнение координат). */
export function positionsDiffer(a: Positioned[], b: Positioned[]): boolean {
  if (a.length !== b.length) return true;
  const byId = new Map(b.map((p) => [p.id, p]));
  return a.some((item) => {
    const other = byId.get(item.id);
    return !other || Math.round(other.x) !== Math.round(item.x) || Math.round(other.y) !== Math.round(item.y);
  });
}
