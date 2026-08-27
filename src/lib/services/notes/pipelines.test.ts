import { describe, expect, it } from 'vitest';

import {
  CONTRAST_SUGGESTION_THRESHOLD,
  clusterConfusions,
  draftExperimentFromIdea,
  firstLine,
  guessVariable,
  seedTutorFromQuestion,
  type ConfusionEntry,
  type IdeaNote,
} from './pipelines';

function idea(overrides: Partial<IdeaNote> = {}): IdeaNote {
  return {
    id: 'note-1',
    title: 'Перемешивание помогает мне сильнее, чем блоки',
    contentMd: 'Кажется, когда мешаю темы, через неделю помню лучше.',
    nodeId: 'n1',
    ...overrides,
  };
}

describe('firstLine', () => {
  it('снимает разметку и берёт первую непустую строку', () => {
    expect(firstLine('\n\n## Заголовок\nтекст')).toBe('Заголовок');
    expect(firstLine('- пункт списка')).toBe('пункт списка');
    expect(firstLine('> цитата')).toBe('цитата');
  });

  it('обрезает длинную строку по границе, а не молча', () => {
    const long = 'а'.repeat(300);
    const result = firstLine(long, 50);
    expect(result).toHaveLength(50);
    expect(result.endsWith('…')).toBe(true);
  });

  it('пустой текст — пустая строка', () => {
    expect(firstLine('   \n\n  ')).toBe('');
  });
});

describe('guessVariable', () => {
  it('узнаёт переменную по словам мысли', () => {
    expect(guessVariable('надо больше перемешивать темы')).toBe('interleaveRatio');
    expect(guessVariable('слишком часто забываю, интервалы короткие')).toBe('requestRetention');
    expect(guessVariable('сколько заданий за раз оптимально')).toBe('itemCount');
    expect(guessVariable('разбор сразу или отложенный?')).toBe('feedbackPolicy');
  });

  it('работает и с английской формулировкой', () => {
    expect(guessVariable('does interleaving actually help me')).toBe('interleaveRatio');
  });

  it('без подсказок берёт самую проверяемую переменную', () => {
    expect(guessVariable('что-то не так с обучением')).toBe('interleaveRatio');
  });
});

describe('draftExperimentFromIdea', () => {
  it('гипотеза берётся из слов человека, а не сочиняется', () => {
    const draft = draftExperimentFromIdea(idea());
    expect(draft.hypothesis).toBe('Перемешивание помогает мне сильнее, чем блоки');
    expect(draft.sourceNoteId).toBe('note-1');
    expect(draft.nodeId).toBe('n1');
  });

  it('без заголовка гипотеза собирается из текста', () => {
    const draft = draftExperimentFromIdea(idea({ title: null }));
    expect(draft.hypothesis).toBe('Кажется, когда мешаю темы, через неделю помню лучше.');
  });

  it('пустая заметка даёт честное приглашение дописать, а не выдуманную гипотезу', () => {
    const draft = draftExperimentFromIdea(idea({ title: null, contentMd: '' }));
    expect(draft.hypothesis).toContain('Сформулируйте');
  });

  it('ветки различимы: одинаковые A и B ничего бы не проверяли', () => {
    const draft = draftExperimentFromIdea(idea());
    expect(draft.armA).not.toEqual(draft.armB);
  });

  it('метрика всегда отложенная — по результату сессии выбиралась бы худшая ветка', () => {
    expect(draftExperimentFromIdea(idea()).metric).toBe('delayed_accuracy');
    expect(draftExperimentFromIdea(idea()).windowDays).toBeGreaterThanOrEqual(7);
  });

  it('детерминированность: одна и та же заметка даёт один и тот же черновик', () => {
    expect(draftExperimentFromIdea(idea())).toEqual(draftExperimentFromIdea(idea()));
  });
});

describe('seedTutorFromQuestion', () => {
  it('в диалог уходит вопрос человека дословно', () => {
    const seed = seedTutorFromQuestion(
      idea({ title: 'Почему интерливинг работает?', contentMd: 'Не понимаю механизм. Разве переключение не мешает?' }),
    );
    expect(seed.openingMessage).toBe('Не понимаю механизм. Разве переключение не мешает?');
    expect(seed.title).toBe('Почему интерливинг работает?');
  });

  it('пустой текст — в диалог уходит заголовок', () => {
    const seed = seedTutorFromQuestion(idea({ title: 'Вопрос', contentMd: '' }));
    expect(seed.openingMessage).toBe('Вопрос');
  });

  it('длинный заголовок обрезается', () => {
    const seed = seedTutorFromQuestion(idea({ title: 'я'.repeat(200) }));
    expect(seed.title.length).toBeLessThanOrEqual(80);
  });
});

describe('clusterConfusions', () => {
  const at = (days: number) => new Date(Date.UTC(2026, 5, days));

  function entry(overrides: Partial<ConfusionEntry> = {}): ConfusionEntry {
    return {
      noteId: 'x',
      title: 'заметка',
      nodeId: 'n1',
      nodeTitle: 'Интерливинг',
      createdAt: at(1),
      ...overrides,
    };
  }

  it('группирует по узлу, а не по дате', () => {
    const clusters = clusterConfusions([
      entry({ noteId: 'a', nodeId: 'n1', createdAt: at(1) }),
      entry({ noteId: 'b', nodeId: 'n2', nodeTitle: 'Контрасты', createdAt: at(2) }),
      entry({ noteId: 'c', nodeId: 'n1', createdAt: at(3) }),
    ]);

    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.nodeId).toBe('n1');
    expect(clusters[0]!.count).toBe(2);
  });

  it('три пометки на одном узле предлагают контрастные задания', () => {
    const many = Array.from({ length: CONTRAST_SUGGESTION_THRESHOLD }, (_, i) =>
      entry({ noteId: `x${i}` }),
    );
    expect(clusterConfusions(many)[0]!.suggestsContrast).toBe(true);
    expect(clusterConfusions(many.slice(0, 2))[0]!.suggestsContrast).toBe(false);
  });

  it('заметки без узла не предлагают контрастов — сравнивать нечего', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      entry({ noteId: `x${i}`, nodeId: null, nodeTitle: null }),
    );
    const cluster = clusterConfusions(many)[0]!;
    expect(cluster.nodeId).toBeNull();
    expect(cluster.suggestsContrast).toBe(false);
  });

  it('внутри кластера свежие сверху', () => {
    const cluster = clusterConfusions([
      entry({ noteId: 'old', createdAt: at(1) }),
      entry({ noteId: 'new', createdAt: at(5) }),
    ])[0]!;
    expect(cluster.entries[0]!.noteId).toBe('new');
  });

  it('пустой вход — пустой выход', () => {
    expect(clusterConfusions([])).toEqual([]);
  });
});
