/**
 * Разрешение конкурентной правки заметки.
 *
 * Правило проекта: конфликт не перетирает чужой результат молча. Для заметок
 * это правило строже, чем для остальных таблиц, потому что здесь конфликтуют
 * не расчётные величины (их можно пересчитать), а авторский текст — потерять
 * его нельзя ничем.
 *
 * Отсюда решение «сохранить обе версии». Автоматическое слияние текста
 * сознательно не делается: трёхстороннее слияние прозы даёт правдоподобный,
 * но не принадлежащий никому результат, и человек не замечает подмены. Две
 * копии рядом — некрасиво, зато честно и обратимо.
 *
 * Модуль чистый: база сюда не ходит, чтобы правило проверялось тестом.
 */

export type NoteVersionState = {
  /** Версия, от которой человек правил. */
  baseVersion: number;
  /** Версия, лежащая в базе сейчас. */
  serverVersion: number;
  /** Текст на сервере — нужен, чтобы решить, есть ли расхождение по существу. */
  serverContentMd: string;
  /** Текст, который человек хочет записать. */
  incomingContentMd: string;
};

export type ConflictDecision =
  /** Версии совпали — обычная запись с инкрементом. */
  | { kind: 'apply'; nextVersion: number }
  /**
   * Версия разошлась, но текст совпадает символ в символ: правка уже доехала
   * (повтор офлайн-очереди, двойная отправка). Копия здесь была бы мусором.
   */
  | { kind: 'already_applied'; serverVersion: number }
  /** Настоящее расхождение: пишем конфликтную копию, оригинал не трогаем. */
  | { kind: 'conflict'; serverVersion: number };

export function decideNoteWrite(state: NoteVersionState): ConflictDecision {
  if (state.baseVersion === state.serverVersion) {
    return { kind: 'apply', nextVersion: state.serverVersion + 1 };
  }

  if (normalize(state.serverContentMd) === normalize(state.incomingContentMd)) {
    return { kind: 'already_applied', serverVersion: state.serverVersion };
  }

  return { kind: 'conflict', serverVersion: state.serverVersion };
}

/**
 * Различия только в переводах строк и хвостовых пробелах — не расхождение
 * по существу: их вносят редакторы и сериализация, а не человек.
 */
function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd();
}

/**
 * Заголовок конфликтной копии. Дата в заголовке обязательна: без неё две
 * копии в списке неразличимы, и человек не понимает, какая из них его
 * последняя.
 */
export function conflictCopyTitle(
  originalTitle: string | null,
  at: Date,
  locale = 'ru-RU',
): string {
  const stamp = at.toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const base = originalTitle?.trim() || 'Без названия';
  return `${base} (конфликтная копия, ${stamp})`;
}
