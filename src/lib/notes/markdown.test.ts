import { describe, expect, it } from 'vitest';

import { escapeHtml, renderNoteMarkdown } from './markdown';

describe('escapeHtml', () => {
  it('закрывает все пять опасных символов', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});

describe('renderNoteMarkdown — безопасность', () => {
  it('теги из текста заметки не становятся разметкой', () => {
    const html = renderNoteMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('обработчик события в тексте остаётся текстом', () => {
    const html = renderNoteMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('<img');
    expect(html).toContain('onerror=&quot;alert(1)&quot;');
  });

  it('javascript: и data: в ссылке не превращаются в href', () => {
    expect(renderNoteMarkdown('[клик](javascript:alert(1))')).not.toContain('href');
    expect(renderNoteMarkdown('[клик](data:text/html,<script>)')).not.toContain('href');
    // Текст ссылки при этом сохраняется — заметка не должна терять содержимое.
    expect(renderNoteMarkdown('[клик](javascript:alert(1))')).toContain('клик');
  });

  it('обычные ссылки работают и открываются безопасно', () => {
    const html = renderNoteMarkdown('[док](https://example.com/a?b=1&c=2)');
    expect(html).toContain('href="https://example.com/a?b=1&amp;c=2"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('renderNoteMarkdown — разметка', () => {
  it('заголовки начинаются с h2: h1 — это поле заголовка заметки', () => {
    expect(renderNoteMarkdown('# Тема')).toBe('<h2>Тема</h2>');
    expect(renderNoteMarkdown('## Подтема')).toBe('<h3>Подтема</h3>');
  });

  it('маркированный и нумерованный списки', () => {
    expect(renderNoteMarkdown('- раз\n- два')).toBe('<ul>\n<li>раз</li>\n<li>два</li>\n</ul>');
    expect(renderNoteMarkdown('1. раз\n2. два')).toBe('<ol>\n<li>раз</li>\n<li>два</li>\n</ol>');
  });

  it('цитата', () => {
    expect(renderNoteMarkdown('> мысль')).toBe('<blockquote>мысль</blockquote>');
  });

  it('внутри блока кода разметка не работает', () => {
    const html = renderNoteMarkdown('```\n**не жирный** и [не ссылка](https://x)\n```');
    expect(html).toContain('**не жирный**');
    expect(html).not.toContain('<strong>');
  });

  it('жирный, курсив и инлайн-код', () => {
    const html = renderNoteMarkdown('**важно**, *акцент*, `код`');
    expect(html).toContain('<strong>важно</strong>');
    expect(html).toContain('<em>акцент</em>');
    expect(html).toContain('<code>код</code>');
  });

  it('wiki-ссылки Obsidian остаются видимыми', () => {
    expect(renderNoteMarkdown('см. [[Интерливинг]]')).toContain('note-wikilink">Интерливинг<');
  });

  it('соседние строки собираются в один абзац, пустая строка разделяет', () => {
    expect(renderNoteMarkdown('первая\nвторая\n\nтретья')).toBe(
      '<p>первая вторая</p>\n<p>третья</p>',
    );
  });

  it('незакрытый блок кода не оставляет висящего тега', () => {
    const html = renderNoteMarkdown('```\nкод без закрытия');
    expect(html.endsWith('</code></pre>')).toBe(true);
  });

  it('пустая заметка — пустая строка, а не мусор', () => {
    expect(renderNoteMarkdown('')).toBe('');
    expect(renderNoteMarkdown('   \n\n  ')).toBe('');
  });
});
