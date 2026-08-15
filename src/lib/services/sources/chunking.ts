/**
 * Разбиение извлечённого текста на фрагменты для `source_chunks`.
 *
 * Без единиц смысла (абзацы, заголовки) чанки резали бы предложения
 * пополам, и generation-контекст получал бы обрубки. Целевой размер держит
 * фрагмент цитируемым: достаточно короткий, чтобы дать модели точную ссылку.
 */

const TARGET_CHUNK_CHARS = 1400;
const MAX_CHUNK_CHARS = 2200;

export type ExtractedChunk = {
  content: string;
  headingPath: string[];
  pageNumber: number | null;
};

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function packParagraphs(paragraphs: string[]): string[] {
  const chunks: string[] = [];
  let buf = '';

  for (const paragraph of paragraphs) {
    const candidate = buf ? `${buf}\n\n${paragraph}` : paragraph;
    if (candidate.length > MAX_CHUNK_CHARS && buf) {
      chunks.push(buf);
      buf = paragraph;
    } else {
      buf = candidate;
    }

    // Абзац сам по себе длиннее лимита — режем жёстко, иначе он никогда не влезет.
    while (buf.length > MAX_CHUNK_CHARS) {
      chunks.push(buf.slice(0, MAX_CHUNK_CHARS));
      buf = buf.slice(MAX_CHUNK_CHARS);
    }

    if (buf.length >= TARGET_CHUNK_CHARS) {
      chunks.push(buf);
      buf = '';
    }
  }

  if (buf) chunks.push(buf);
  return chunks;
}

export function chunkPlainText(text: string): ExtractedChunk[] {
  return packParagraphs(splitParagraphs(text)).map((content) => ({
    content,
    headingPath: [],
    pageNumber: null,
  }));
}

const HEADING_RE = /^(#{1,6})\s+(.*)/;

export function chunkMarkdown(text: string): ExtractedChunk[] {
  const stack: string[] = [];
  const sections: { headingPath: string[]; lines: string[] }[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.some((line) => line.trim())) {
      sections.push({ headingPath: [...stack], lines: current });
    }
    current = [];
  };

  for (const line of text.split('\n')) {
    const match = HEADING_RE.exec(line);
    if (match) {
      flush();
      const level = match[1]!.length;
      stack.length = level - 1;
      stack[level - 1] = match[2]!.trim();
      continue;
    }
    current.push(line);
  }
  flush();

  const chunks: ExtractedChunk[] = [];
  for (const section of sections) {
    const body = section.lines.join('\n').trim();
    if (!body) continue;
    for (const content of packParagraphs(splitParagraphs(body))) {
      chunks.push({ content, headingPath: section.headingPath, pageNumber: null });
    }
  }
  return chunks;
}

export function chunkPdfPages(pages: string[]): ExtractedChunk[] {
  const chunks: ExtractedChunk[] = [];
  pages.forEach((pageText, i) => {
    for (const content of packParagraphs(splitParagraphs(pageText))) {
      chunks.push({ content, headingPath: [], pageNumber: i + 1 });
    }
  });
  return chunks;
}
