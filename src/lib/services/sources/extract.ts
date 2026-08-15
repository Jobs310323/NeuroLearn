import { extractText, getDocumentProxy } from 'unpdf';

import type { sourceKindEnum } from '@/lib/db/schema';

import { chunkMarkdown, chunkPdfPages, chunkPlainText, type ExtractedChunk } from './chunking';

export type SourceKind = (typeof sourceKindEnum.enumValues)[number];

export class UnsupportedSourceKindError extends Error {}

/**
 * Извлечение текста по типу источника. Файл не сохраняется — только его
 * текст, разбитый на фрагменты (см. `sources.ts`: оригинал отбрасывается).
 */
export async function extractChunks(
  kind: SourceKind,
  input: { buffer?: Uint8Array; text?: string },
): Promise<ExtractedChunk[]> {
  switch (kind) {
    case 'pdf': {
      if (!input.buffer) throw new Error('Для PDF нужен файл');
      const pdf = await getDocumentProxy(input.buffer);
      const { text } = await extractText(pdf, { mergePages: false });
      return chunkPdfPages(text);
    }
    case 'markdown':
      return chunkMarkdown(input.text ?? '');
    case 'plain_text':
    case 'ai_notes':
      return chunkPlainText(input.text ?? '');
    case 'url':
    case 'epub':
      throw new UnsupportedSourceKindError(`Импорт типа «${kind}» пока не поддержан`);
  }
}
