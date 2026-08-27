/**
 * Умные подсказки в практике — типы движка правил.
 *
 * Движок детерминированный: ноль импортов из `lib/ai`. Проверяется тестом
 * (`no-ai-imports.test.ts`), а не соглашением — иначе однажды кто-нибудь
 * добавит «умную формулировку от модели», и подсказки перестанут работать
 * при нулевом лимите провайдеров.
 *
 * Отдельно оговорено (инвариант дисциплины сигналов): ни одно правило не
 * меняет подбор заданий, длину набора и расписание FSRS. Подсказка — это
 * сообщение человеку, а не вход в `decidePolicy`. За этим тоже следит тест.
 */

export type HintRuleId =
  | 'rest_suggestion'
  | 'metacognitive_coaching'
  | 'contrast_mode_offer'
  | 'difficulty_indicator'
  | 'capture_nudge'
  | 'review_before_session';

/** Ответ в текущей сессии — вход правил. Только внутрисессионная телеметрия. */
export type HintResponseSample = {
  assessmentId: string;
  nodeId: string;
  isCorrect: boolean;
  responseTimeMs: number;
  /** 1..5, постдиктивная уверенность. */
  confidenceLevel: number | null;
  /** 1..5, Judgment of Knowing (проспективная). */
  jokLevel: number | null;
  cognitiveLevel: string | null;
  /** Тип ошибки из таксономии, если разбор уже есть. */
  errorKind: string | null;
  /** Человек нажал «не понял» на этом задании. */
  flaggedConfusion: boolean;
  /** Тип блока задания — `transfer_task` отличается от остальных. */
  blockType: string | null;
};

/** Действие рядом с подсказкой. Открывает экран, но никогда не модалку сам. */
export type HintAction =
  | { kind: 'start_rest_timer'; seconds: number }
  | { kind: 'open_contrast'; nodeId: string }
  | { kind: 'capture_note'; nodeId: string; assessmentId: string | null; confusion: boolean }
  | { kind: 'open_note'; noteId: string }
  | { kind: 'open_tutor'; nodeId: string; assessmentId: string | null }
  | { kind: 'request_hint' };

export type Hint = {
  ruleId: HintRuleId;
  /** Ключ локализации текста. Сам текст живёт в messages/{locale}. */
  messageKey: string;
  /** Подстановки в текст: числа и названия узлов. */
  values: Record<string, string | number>;
  priority: number;
  action: HintAction | null;
  /** Пояснение «почему это показано» — человек вправе знать основание. */
  reasonKey: string;
};

/** Сработавшие подсказки текущей сессии — вход для cooldown и лимитов. */
export type HintShownRecord = {
  ruleId: HintRuleId;
  /** Порядковый номер задания, после которого подсказка была показана. */
  atIndex: number;
};

export type HintContext = {
  /** Режим сессии. В `pre_assessment` подсказки не работают вовсе. */
  mode: string;
  /** Ответы текущей сессии по порядку. */
  responses: HintResponseSample[];
  /** Индекс только что отвеченного задания (0-based). */
  currentIndex: number;
  /** Соседи узлов по графу (related/contrast, BFS-1). */
  neighbours: Record<string, string[]>;
  /** Живые заметки, которые стоит перечитать перед узлами этой сессии. */
  dueNotes: { noteId: string; title: string; nodeId: string }[];
  /** Уровень Блума следующего задания — для чипа сложности. */
  nextCognitiveLevel: string | null;
  shown: HintShownRecord[];
  /** Мастер-выключатель и отключённые типы из настроек пользователя. */
  enabled: boolean;
  disabledRules: string[];
};

export type HintRule = {
  id: HintRuleId;
  /** Больше — важнее. При нескольких сработавших показывается одна, старшая. */
  priority: number;
  /** Минимум заданий между двумя срабатываниями одного правила. */
  cooldownItems: number;
  /** Максимум срабатываний правила за сессию. */
  maxPerSession: number;
  /**
   * Чистая функция. `null` — не сработало. Никаких обращений к сети, базе,
   * времени и случайности: правило обязано быть воспроизводимым по контексту.
   */
  evaluate: (context: HintContext) => Omit<Hint, 'ruleId' | 'priority'> | null;
};

/** Что произошло с показанной подсказкой — пишется в `hint_events`. */
export type HintOutcome = 'shown' | 'dismissed' | 'acted' | 'muted';
