/**
 * Реальный вектор инъекции в проекте — не чат с тьютором (это диалог
 * владельца с собственным ассистентом), а `collectSourceExcerpts`
 * (`src/lib/ai/agents/content-generator.ts`): текст источника (PDF,
 * расшифровка аудио, вставленный конспект) попадает в промпт генератора
 * почти дословно. Если в источнике есть текст вида «игнорируй инструкции
 * выше» — эвристика не блокирует (ложные срабатывания на легитимных
 * конспектах вероятны), а помечает для лога и оборачивает текст явными
 * границами, чтобы модель воспринимала его как данные, а не команды.
 */

const INJECTION_PATTERNS: RegExp[] = [
  /игнорируй\s+(все\s+)?(предыдущие|прошлые|указанные)\s+инструкции/i,
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /you\s+are\s+now\s+/i,
  /ты\s+теперь\s+/i,
  /system\s*:\s*/i,
  /\[?end\s+of\s+(prompt|system|instructions)\]?/i,
  /disregard\s+(all\s+)?(previous|prior)/i,
  /новая\s+системная\s+инструкция/i,
];

export function flagPromptInjection(text: string): { flagged: boolean; reasons: string[] } {
  const reasons = INJECTION_PATTERNS.filter((p) => p.test(text)).map((p) => p.source);
  return { flagged: reasons.length > 0, reasons };
}

/** Явно размечает текст как данные — модель инструктирована не выполнять то, что внутри. */
export function wrapUntrustedText(text: string): string {
  return `<untrusted_source_data>\n${text}\n</untrusted_source_data>`;
}
