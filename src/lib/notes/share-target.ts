/**
 * Разбор того, что операционная система передаёт при «Поделиться».
 *
 * Поведение отличается от системы к системе и от приложения к приложению:
 * браузер шлёт `url` отдельно, мессенджер кладёт ссылку внутрь `text`, а
 * читалка передаёт цитату в `text` и заголовок книги в `title`. Разбор
 * сведён в одну чистую функцию с тестами, иначе каждый частный случай
 * чинился бы вслепую по жалобе.
 *
 * Ничего не выбрасывается: даже если разбор не удался, исходный текст
 * попадает в заметку целиком. Потерять то, чем человек поделился, нельзя.
 */

export type ShareInput = {
  title?: string | null;
  text?: string | null;
  url?: string | null;
};

export type SharedNoteDraft = {
  title: string | null;
  contentMd: string;
  type: 'capture' | 'quote' | 'link_note';
};

/** Ссылка целиком, а не внутри предложения. */
const BARE_URL = /^https?:\/\/\S+$/i;
const URL_IN_TEXT = /https?:\/\/\S+/i;

export function parseShare(input: ShareInput): SharedNoteDraft {
  const title = input.title?.trim() || null;
  const text = input.text?.trim() ?? '';
  const url = input.url?.trim() ?? '';

  // Мессенджеры кладут ссылку в `text`, если `url` не поддержан системой.
  const link = url || (BARE_URL.test(text) ? text : (URL_IN_TEXT.exec(text)?.[0] ?? ''));
  const body = BARE_URL.test(text) && text === link ? '' : text;

  const lines: string[] = [];
  if (body) lines.push(body);
  if (link) lines.push(`[Источник](${link})`);

  // Тип угадывается по составу: только ссылка — связка, длинный текст со
  // ссылкой — цитата из источника, остальное — обычный перехват.
  const type: SharedNoteDraft['type'] = !body && link
    ? 'link_note'
    : body && link
      ? 'quote'
      : 'capture';

  return {
    title: title ?? (link && !body ? hostOf(link) : null),
    contentMd: lines.join('\n\n'),
    type,
  };
}

function hostOf(link: string): string | null {
  try {
    return new URL(link).host;
  } catch {
    return null;
  }
}
