/**
 * Экспорт тетради в Markdown с YAML front-matter в формате Obsidian.
 *
 * Формат выбран не ради моды: front-matter + `[[wiki-ссылки]]` читает не
 * только Obsidian, а простые `.md`-файлы переживут и это приложение, и любой
 * следующий редактор. Тетрадь — авторский текст человека, и он обязан иметь
 * возможность унести его целиком, без экспортного API на нашей стороне.
 *
 * Чистые функции: сериализация проверяется тестами, без базы и без файловой
 * системы.
 */

export type ExportableNote = {
  id: string;
  type: string;
  title: string | null;
  contentMd: string;
  colorLabel: string;
  tags: string[];
  nodeTitle: string | null;
  sourceTitle: string | null;
  pinned: boolean;
  resurfaceAt: string | null;
  createdAt: string;
  updatedAt: string;
  links: { title: string | null; relation: string; direction: 'out' | 'in' }[];
};

/**
 * YAML-скаляр. Кавычки ставятся не «на всякий случай», а когда без них
 * значение меняет смысл: `-` в начале — это список, `:` — вложенный ключ,
 * `2026-01-01` — дата, `yes` — булево.
 */
export function yamlScalar(value: string): string {
  if (value === '') return "''";
  const needsQuotes =
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) ||
    /:\s|\s#/.test(value) ||
    /^(true|false|yes|no|on|off|null|~)$/i.test(value) ||
    /^-?\d+(\.\d+)?$/.test(value) ||
    /^\d{4}-\d{2}-\d{2}/.test(value) ||
    value !== value.trim();

  if (!needsQuotes) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

/** Имя файла: без разделителей пути и служебных символов Windows. */
export function safeFileName(note: ExportableNote): string {
  const base = (note.title?.trim() || 'Без названия')
    .replace(/[/\\:*?"<>|#^[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  // Хвост id — чтобы две заметки с одинаковым заголовком не затирали друг друга.
  return `${base || 'Заметка'} ${note.id.slice(0, 8)}.md`;
}

export function toMarkdownFile(note: ExportableNote): string {
  const front: string[] = [
    '---',
    `id: ${note.id}`,
    `type: ${note.type}`,
    `title: ${yamlScalar(note.title ?? '')}`,
    `color: ${note.colorLabel}`,
    `created: ${note.createdAt}`,
    `updated: ${note.updatedAt}`,
  ];

  if (note.tags.length > 0) {
    front.push(`tags: [${note.tags.map(yamlScalar).join(', ')}]`);
  }
  if (note.nodeTitle) front.push(`node: ${yamlScalar(note.nodeTitle)}`);
  if (note.sourceTitle) front.push(`source: ${yamlScalar(note.sourceTitle)}`);
  if (note.pinned) front.push('pinned: true');
  if (note.resurfaceAt) front.push(`resurface: ${note.resurfaceAt}`);
  front.push('---', '');

  const body = [note.contentMd.trimEnd()];

  const outgoing = note.links.filter((l) => l.direction === 'out' && l.title);
  const incoming = note.links.filter((l) => l.direction === 'in' && l.title);

  if (outgoing.length > 0 || incoming.length > 0) {
    body.push('', '## Связи', '');
    for (const link of outgoing) body.push(`- ${link.relation} → [[${link.title}]]`);
    for (const link of incoming) body.push(`- [[${link.title}]] → ${link.relation}`);
  }

  return `${front.join('\n')}${body.join('\n')}\n`;
}

/** Индексный файл: точка входа в выгрузку, без него это просто россыпь .md. */
export function buildIndexFile(notes: ExportableNote[], exportedAt: Date): string {
  const lines = [
    '---',
    'title: Рабочая тетрадь NeuroLearn',
    `exported: ${exportedAt.toISOString()}`,
    `count: ${notes.length}`,
    '---',
    '',
    '# Рабочая тетрадь',
    '',
    `Выгружено заметок: ${notes.length}.`,
    '',
  ];

  const byNode = new Map<string, ExportableNote[]>();
  for (const note of notes) {
    const key = note.nodeTitle ?? 'Без узла';
    const list = byNode.get(key);
    if (list) list.push(note);
    else byNode.set(key, [note]);
  }

  for (const [node, list] of [...byNode.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`## ${node}`, '');
    for (const note of list) {
      lines.push(`- [[${safeFileName(note).replace(/\.md$/, '')}]]`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
