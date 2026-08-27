/**
 * Показ Markdown-заметки.
 *
 * Порядок операций — единственное, что здесь по-настоящему важно: сначала
 * экранируется ВЕСЬ ввод, и только потом на уже безопасный текст ложится
 * разметка. Обратный порядок (разметка, затем частичное экранирование) —
 * классический способ получить XSS в собственной заметке; сюда попадает и
 * текст, сгенерированный моделью, и вставленный из чужого конспекта.
 *
 * Поддерживается сознательно узкое подмножество: заголовки, списки, цитаты,
 * код, выделение, ссылки. Больше тетради не нужно, а каждый лишний тег — это
 * ещё одна поверхность, за безопасностью которой надо следить.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

/**
 * Разрешены только http(s) и mailto. `javascript:` и `data:` в href — рабочий
 * способ выполнить чужой код по клику, и относиться к ним как к «просто
 * ссылке» нельзя.
 */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  // Относительная ссылка внутрь приложения — тоже допустима.
  if (/^\/[^/]/.test(trimmed)) return trimmed;
  return null;
}

function inline(text: string): string {
  return (
    text
      // Код первым: внутри него разметка не должна работать.
      .replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\[\[([^\]]+)\]\]/g, '<span class="note-wikilink">$1</span>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
        const safe = safeHref(unescapeEntities(href));
        if (!safe) return label;
        return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      })
  );
}

/** Внутри href нужен исходный текст: он экранируется заново уже как атрибут. */
function unescapeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Возвращает HTML-строку. Вставляется через `dangerouslySetInnerHTML` — это
 * безопасно ровно потому, что весь ввод экранирован первой же операцией.
 */
export function renderNoteMarkdown(markdown: string): string {
  const escaped = escapeHtml(markdown.replace(/\r\n/g, '\n'));
  const lines = escaped.split('\n');
  const html: string[] = [];

  let listOpen: 'ul' | 'ol' | null = null;
  let inCode = false;
  let paragraph: string[] = [];

  const closeList = () => {
    if (listOpen) {
      html.push(`</${listOpen}>`);
      listOpen = null;
    }
  };
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      html.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flushParagraph();
      closeList();
      html.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      html.push(line);
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      // h1 в заметке — это её заголовок, он живёт отдельным полем; текст
      // начинается с h2, чтобы структура страницы оставалась осмысленной.
      const level = Math.min(6, heading[1]!.length + 1);
      html.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }

    const quote = /^&gt;\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${inline(quote[1]!)}</blockquote>`);
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (listOpen !== 'ul') {
        closeList();
        html.push('<ul>');
        listOpen = 'ul';
      }
      html.push(`<li>${inline(bullet[1]!)}</li>`);
      continue;
    }

    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      flushParagraph();
      if (listOpen !== 'ol') {
        closeList();
        html.push('<ol>');
        listOpen = 'ol';
      }
      html.push(`<li>${inline(ordered[1]!)}</li>`);
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  closeList();
  if (inCode) html.push('</code></pre>');

  return html.join('\n');
}
