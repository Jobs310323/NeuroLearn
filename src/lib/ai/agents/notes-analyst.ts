import { z } from 'zod';

import { generateValidated } from '../generate';

/**
 * AI-слой тетради: авто-теги, суммаризация треда узла и нарратив недельного
 * итога.
 *
 * Три правила, общие для всего файла.
 *
 * 1. Модель НИКОГДА не пишет в пользовательский текст. Всё, что она
 *    возвращает, — черновик рядом: теги предлагаются, сводка показывается
 *    отдельным блоком, нарратив недели открывается на правку. Заметка
 *    остаётся ровно такой, какой её оставил человек.
 *
 * 2. Факты модель не добывает, а получает. Недельный итог считается
 *    арифметикой (`services/notes/weekly.ts`), противоречия отбираются
 *    правилами; модель только связывает готовые числа в текст. Модель,
 *    которой отдали сырые заметки и попросили «найти закономерности», найдёт
 *    их всегда — это её работа, а не свойство данных.
 *
 * 3. Всё идёт через `generateValidated`: Zod, аудит в `ai_generations`,
 *    circuit breaker. Отдельного пути в обход здесь нет.
 *
 * Агент регистрируется как `progress_analyzer`: он анализирует накопленное и
 * ничего не генерирует как учебный материал. Заводить пятый вид агента ради
 * тетради значило бы удваивать реестр моделей и версий промптов ради одного
 * различия в названии.
 */

const AGENT = 'progress_analyzer' as const;

// --- Авто-теги ----------------------------------------------------------

const tagsSchema = z.object({
  tags: z
    .array(z.string().trim().min(2).max(30))
    .max(6)
    .describe('Короткие теги в нижнем регистре, по-русски или на языке заметки'),
});

/**
 * Предложение тегов. Именно предложение: результат показывается человеку
 * кнопками «добавить», а не дописывается в заметку.
 *
 * Шесть тегов максимум. Больше — это уже не метки, а пересказ, и человек
 * перестаёт их читать вовсе.
 */
export async function suggestTags(params: {
  userId: string;
  noteId: string;
  title: string | null;
  contentMd: string;
  existingTags: string[];
}): Promise<{ tags: string[]; generationId: string }> {
  const { data, generationId } = await generateValidated({
    agent: AGENT,
    operation: 'notes_auto_tags',
    userId: params.userId,
    targetTable: 'notes',
    targetId: params.noteId,
    system: [
      'Ты помечаешь заметки короткими тегами для поиска.',
      'Тег — это тема, а не пересказ: 1–2 слова, нижний регистр.',
      'Язык тегов — язык заметки.',
      'Не выдумывай темы, которых в тексте нет. Лучше два точных тега, чем шесть приблизительных.',
    ].join(' '),
    prompt: [
      params.existingTags.length > 0
        ? `Уже проставлены: ${params.existingTags.join(', ')}. Их не повторяй.`
        : '',
      `Заголовок: ${params.title ?? '(без заголовка)'}`,
      'Текст заметки:',
      params.contentMd.slice(0, 4000),
    ]
      .filter(Boolean)
      .join('\n'),
    schema: tagsSchema,
    maxOutputTokens: 200,
  });

  const existing = new Set(params.existingTags.map((tag) => tag.toLowerCase()));
  return {
    tags: data.tags
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag.length > 0 && !existing.has(tag)),
    generationId,
  };
}

// --- Сводка треда узла --------------------------------------------------

const summarySchema = z.object({
  summary: z.string().trim().min(20).max(1200),
  openQuestions: z.array(z.string().trim().min(5).max(200)).max(5),
});

/**
 * Сводка всех заметок по одному узлу.
 *
 * `openQuestions` отдельным полем, а не внутри текста: незакрытые вопросы —
 * самое полезное, что есть в накопленных заметках, и утонуть в абзаце они не
 * должны. Из них же собирается очередь тьютора.
 */
export async function summarizeNodeThread(params: {
  userId: string;
  nodeId: string;
  nodeTitle: string;
  notes: { title: string | null; contentMd: string; type: string }[];
}): Promise<{ summary: string; openQuestions: string[]; generationId: string }> {
  const { data, generationId } = await generateValidated({
    agent: AGENT,
    operation: 'notes_thread_summary',
    userId: params.userId,
    targetTable: 'knowledge_nodes',
    targetId: params.nodeId,
    system: [
      'Ты собираешь заметки человека по одной теме в связную сводку.',
      'Пиши от третьего лица о содержании заметок, не оценивай автора.',
      'Опирайся только на то, что в заметках. Ничего не добавляй от себя.',
      'Отдельно выпиши вопросы, которые в заметках заданы, но не закрыты.',
    ].join(' '),
    prompt: [
      `Тема: ${params.nodeTitle}`,
      '',
      ...params.notes
        .slice(0, 40)
        .map(
          (note, index) =>
            `[${index + 1}] (${note.type}) ${note.title ?? ''}\n${note.contentMd.slice(0, 1200)}`,
        ),
    ].join('\n'),
    schema: summarySchema,
    maxOutputTokens: 900,
  });

  return { ...data, generationId };
}

// --- Нарратив недельного итога ------------------------------------------

const digestSchema = z.object({
  narrative: z.string().trim().min(40).max(2000),
});

/**
 * Черновик недельного итога.
 *
 * Модель получает УЖЕ посчитанные числа и отобранные правилами противоречия,
 * а её задача — связать их в текст. Проверяемых утверждений она не порождает:
 * всё, что можно перепроверить, посчитано до неё.
 *
 * Результат помечен как черновик и открывается на правку. Итог недели — это
 * запись человека о своей неделе; текст, который он не трогал, ею не является.
 */
export async function draftWeeklyNarrative(params: {
  userId: string;
  stats: {
    total: number;
    connectedShare: number;
    deepShare: number;
    confusionCount: number;
    medianLength: number;
  };
  topNodeTitles: string[];
  contradictions: { noteTitle: string | null; nodeTitle: string; evidence: string }[];
}): Promise<{ narrative: string; generationId: string }> {
  const { data, generationId } = await generateValidated({
    agent: AGENT,
    operation: 'notes_weekly_digest',
    userId: params.userId,
    system: [
      'Ты пишешь черновик недельного итога по УЖЕ посчитанным числам.',
      'Не добавляй чисел, которых нет во входных данных, и не делай выводов о причинах.',
      'Тон спокойный и без похвалы: это не отчёт о достижениях, а описание недели.',
      'Ни «молодец», ни «отличная работа», ни сравнений с другими неделями, если данных о них нет.',
      'Если противоречия переданы — назови их фактом, не обвинением: заметка утверждает одно, практика показывает другое.',
    ].join(' '),
    prompt: JSON.stringify(
      {
        заметок: params.stats.total,
        доля_связанных: Number(params.stats.connectedShare.toFixed(2)),
        доля_разобранных: Number(params.stats.deepShare.toFixed(2)),
        пометок_не_понял: params.stats.confusionCount,
        медианная_длина: params.stats.medianLength,
        частые_темы: params.topNodeTitles,
        противоречия: params.contradictions,
      },
      null,
      2,
    ),
    schema: digestSchema,
    maxOutputTokens: 800,
  });

  return { ...data, generationId };
}
