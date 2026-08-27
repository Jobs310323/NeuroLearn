import { describe, expect, it } from 'vitest';

import {
  isSnapshotUsable,
  positionsDiffer,
  SNAPSHOT_TTL_MS,
  takeSnapshot,
} from './layout-snapshot';

describe('takeSnapshot', () => {
  it('снимает копию, а не ссылку на живой массив', () => {
    const positions = [{ id: 'a', x: 0, y: 0 }];
    const snapshot = takeSnapshot(positions, 3, 'Упорядочить');

    // Карта мутирует позиции при перетаскивании — снимок «до» обязан выжить.
    positions[0]!.x = 999;

    expect(snapshot.positions[0]!.x).toBe(0);
    expect(snapshot.layoutVersion).toBe(3);
  });
});

describe('isSnapshotUsable', () => {
  it('свежий снимок годен', () => {
    const snapshot = takeSnapshot([], 1, 'x', 1_000);
    expect(isSnapshotUsable(snapshot, 1_000 + SNAPSHOT_TTL_MS - 1)).toBe(true);
  });

  it('протухший снимок не предлагается: за это время накопилась ручная правка', () => {
    const snapshot = takeSnapshot([], 1, 'x', 1_000);
    expect(isSnapshotUsable(snapshot, 1_000 + SNAPSHOT_TTL_MS + 1)).toBe(false);
  });

  it('отсутствие снимка — не годен', () => {
    expect(isSnapshotUsable(null)).toBe(false);
  });
});

describe('positionsDiffer', () => {
  it('одинаковые позиции — нет разницы', () => {
    const a = [{ id: 'a', x: 10, y: 20 }];
    expect(positionsDiffer(a, [{ id: 'a', x: 10, y: 20 }])).toBe(false);
  });

  it('субпиксельный сдвиг не считается изменением', () => {
    expect(positionsDiffer([{ id: 'a', x: 10.2, y: 20.1 }], [{ id: 'a', x: 10, y: 20 }])).toBe(
      false,
    );
  });

  it('сдвиг узла и появление нового узла — изменение', () => {
    expect(positionsDiffer([{ id: 'a', x: 10, y: 20 }], [{ id: 'a', x: 40, y: 20 }])).toBe(true);
    expect(
      positionsDiffer(
        [{ id: 'a', x: 10, y: 20 }],
        [
          { id: 'a', x: 10, y: 20 },
          { id: 'b', x: 0, y: 0 },
        ],
      ),
    ).toBe(true);
  });

  it('переименованный узел — изменение, а не совпадение по количеству', () => {
    expect(positionsDiffer([{ id: 'a', x: 0, y: 0 }], [{ id: 'b', x: 0, y: 0 }])).toBe(true);
  });
});
