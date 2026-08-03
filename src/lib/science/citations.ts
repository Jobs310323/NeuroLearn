/**
 * Реестр исследований, на которых стоит продукт.
 *
 * Правило: DOI не указываем, если он не подтверждён вручную — вместо этого
 * даём точное название работы, авторов, год и издание. UI строит ссылку
 * на Google Scholar из поля `searchQuery` (см. `scholarUrl`).
 *
 * Каждый ключ используется в `content_blocks.science_citation_key` и в
 * компоненте `<ScienceHint citation="..." />` — тултип «Почему мы так делаем?».
 */

export type Citation = {
  key: CitationKey;
  /** Что именно мы делаем в продукте из-за этой работы. */
  productRule: string;
  authors: string;
  year: number;
  title: string;
  source: string;
  /** Одно предложение — вывод работы, без преувеличений. */
  finding: string;
  searchQuery: string;
};

export const CITATION_KEYS = [
  'testing_effect',
  'pretesting',
  'spacing_effect',
  'fsrs',
  'interleaving',
  'generation_effect',
  'metacognition',
  'delayed_feedback',
  'variability_of_practice',
  'desirable_difficulties',
  'worked_examples',
  'automaticity',
  'calibration',
] as const;

export type CitationKey = (typeof CITATION_KEYS)[number];

export const CITATIONS: Record<CitationKey, Citation> = {
  testing_effect: {
    key: 'testing_effect',
    productRule: 'Каждая тема начинается с теста, а не с теории.',
    authors: 'Roediger, H. L., & Karpicke, J. D.',
    year: 2006,
    title:
      'Test-Enhanced Learning: Taking Memory Tests Improves Long-Term Retention',
    source: 'Psychological Science',
    finding:
      'Извлечение из памяти улучшает долговременное удержание сильнее, чем повторное чтение того же материала.',
    searchQuery: 'Roediger Karpicke 2006 test-enhanced learning',
  },
  pretesting: {
    key: 'pretesting',
    productRule:
      'Блок `pre_assessment` даётся до объяснения — ошибки на нём полезны.',
    authors: 'Richland, L. E., Kornell, N., & Kao, L. S.',
    year: 2009,
    title: 'Can Unsuccessful Tests Enhance Learning?',
    source: 'Journal of Experimental Psychology: Applied',
    finding:
      'Попытка ответить до изучения материала улучшает последующее усвоение, даже когда ответ неверный.',
    searchQuery: 'Richland Kornell Kao 2009 unsuccessful tests enhance learning',
  },
  spacing_effect: {
    key: 'spacing_effect',
    productRule: 'Повторения разносим во времени, а не собираем в один блок.',
    authors: 'Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D.',
    year: 2006,
    title:
      'Distributed Practice in Verbal Recall Tasks: A Review and Quantitative Synthesis',
    source: 'Psychological Bulletin',
    finding:
      'Распределённая практика превосходит массированную; оптимальный интервал растёт вместе с целевым сроком удержания.',
    searchQuery: 'Cepeda Pashler 2006 distributed practice quantitative synthesis',
  },
  fsrs: {
    key: 'fsrs',
    productRule:
      'Интервалы считает FSRS (библиотека `ts-fsrs`), а не фиксированные множители SM-2.',
    authors: 'Ye, J., et al. (проект Open Spaced Repetition)',
    year: 2023,
    title: 'Free Spaced Repetition Scheduler (FSRS): a modern spaced repetition algorithm',
    source: 'Open Spaced Repetition / реализация ts-fsrs',
    finding:
      'Модель памяти с параметрами стабильности, сложности и извлекаемости планирует повторения точнее эвристик семейства SM-2.',
    searchQuery: 'FSRS free spaced repetition scheduler algorithm',
  },
  interleaving: {
    key: 'interleaving',
    productRule:
      'Практика с `mix=true` перемешивает задания смежных тем вместо блочной отработки одной.',
    authors: 'Rohrer, D.',
    year: 2012,
    title: 'Interleaving Helps Students Distinguish among Similar Concepts',
    source: 'Educational Psychology Review',
    finding:
      'Перемешивание типов задач ухудшает результат на тренировке, но улучшает отложенный перенос и различение похожих понятий.',
    searchQuery: 'Rohrer 2012 interleaving helps students distinguish similar concepts',
  },
  generation_effect: {
    key: 'generation_effect',
    productRule:
      'Тьютор работает через инструмент `SocraticMethod`: возвращает наводящие вопросы, а не готовый ответ.',
    authors: 'Slamecka, N. J., & Graf, P.',
    year: 1978,
    title: 'The Generation Effect: Delineation of a Phenomenon',
    source: 'Journal of Experimental Psychology: Human Learning and Memory',
    finding:
      'Самостоятельно порождённый материал запоминается лучше прочитанного готового.',
    searchQuery: 'Slamecka Graf 1978 generation effect delineation phenomenon',
  },
  metacognition: {
    key: 'metacognition',
    productRule:
      'После модуля обязателен дневник обучения; узел не станет `mastered` без рефлексии.',
    authors: 'Flavell, J. H.',
    year: 1979,
    title:
      'Metacognition and Cognitive Monitoring: A New Area of Cognitive-Developmental Inquiry',
    source: 'American Psychologist',
    finding:
      'Отслеживание собственного понимания — отдельный навык, который управляет выбором стратегий обучения.',
    searchQuery: 'Flavell 1979 metacognition cognitive monitoring',
  },
  delayed_feedback: {
    key: 'delayed_feedback',
    productRule:
      'Факты — мгновенная обратная связь; сложные кейсы — результат только после завершения теста.',
    authors: 'Shute, V. J.',
    year: 2008,
    title: 'Focus on Formative Feedback',
    source: 'Review of Educational Research',
    finding:
      'Немедленная обратная связь помогает на простых задачах, отложенная — на сложных, где важна самостоятельная обработка.',
    searchQuery: 'Shute 2008 focus on formative feedback',
  },
  variability_of_practice: {
    key: 'variability_of_practice',
    productRule:
      'Генератор создаёт 3–5 примеров одного принципа в разных контекстах (`variant_group_id`).',
    authors: 'Schmidt, R. A.',
    year: 1975,
    title: 'A Schema Theory of Discrete Motor Skill Learning',
    source: 'Psychological Review',
    finding:
      'Вариативная практика формирует обобщённую схему навыка и улучшает перенос на новые условия.',
    searchQuery: 'Schmidt 1975 schema theory discrete motor skill learning variability',
  },
  desirable_difficulties: {
    key: 'desirable_difficulties',
    productRule:
      'Намеренно усложняем тренировку (интерливинг, отложенная проверка) — падение скорости на сессии ожидаемо.',
    authors: 'Bjork, R. A., & Bjork, E. L.',
    year: 2011,
    title:
      'Making Things Hard on Yourself, but in a Good Way: Creating Desirable Difficulties to Enhance Learning',
    source: 'Psychology and the Real World',
    finding:
      'Условия, ухудшающие результат во время тренировки, часто улучшают долговременное удержание и перенос.',
    searchQuery: 'Bjork 2011 desirable difficulties enhance learning',
  },
  worked_examples: {
    key: 'worked_examples',
    productRule:
      'Блок 4 — разобранный пример; подсказки в блоке 6 затухают от сессии к сессии.',
    authors: 'Sweller, J., & Cooper, G. A.',
    year: 1985,
    title:
      'The Use of Worked Examples as a Substitute for Problem Solving in Learning Algebra',
    source: 'Cognition and Instruction',
    finding:
      'На старте изучения разобранные примеры эффективнее самостоятельного решения; по мере роста экспертизы преимущество исчезает.',
    searchQuery: 'Sweller Cooper 1985 worked examples substitute problem solving',
  },
  automaticity: {
    key: 'automaticity',
    productRule:
      'Статус `automated` требует не только точности, но и стабильно низкого времени реакции.',
    authors: 'Shiffrin, R. M., & Schneider, W.',
    year: 1977,
    title:
      'Controlled and Automatic Human Information Processing: II. Perceptual Learning, Automatic Attending and a General Theory',
    source: 'Psychological Review',
    finding:
      'Автоматическая обработка формируется последовательной практикой и отличается скоростью и низкой нагрузкой на внимание.',
    searchQuery: 'Shiffrin Schneider 1977 controlled automatic human information processing',
  },
  calibration: {
    key: 'calibration',
    productRule:
      'Уверенность спрашиваем ДО показа результата и сравниваем с фактической точностью.',
    authors: 'Dunlosky, J., & Rawson, K. A.',
    year: 2012,
    title:
      'Overconfidence Produces Underachievement: Inaccurate Self Evaluations Undermine Students’ Learning and Retention',
    source: 'Learning and Instruction',
    finding:
      'Переоценка собственного понимания приводит к преждевременному прекращению практики и худшему удержанию.',
    searchQuery: 'Dunlosky Rawson 2012 overconfidence produces underachievement',
  },
};

/** Ссылка для тултипа. Google Scholar, а не выдуманный DOI. */
export function scholarUrl(key: CitationKey): string {
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(
    CITATIONS[key].searchQuery,
  )}`;
}

export function formatCitation(key: CitationKey): string {
  const c = CITATIONS[key];
  return `${c.authors} (${c.year}). ${c.title}. ${c.source}.`;
}
