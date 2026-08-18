import { Dumbbell } from 'lucide-react';
import Link from 'next/link';

import { ScienceHint } from '@/components/science-hint';
import { Button } from '@/components/ui/button';
import { CITATION_KEYS, type CitationKey } from '@/lib/science/citations';
import type { ReadingBlock } from '@/lib/db/queries/reading';

/** Заголовок блока для читателя — не совпадает с `type` из БД дословно. */
const BLOCK_LABEL: Record<ReadingBlock['type'], string> = {
  pre_assessment: 'Проверка перед началом',
  activation: 'Вспомните, что уже знаете',
  concept: 'Теория',
  worked_example: 'Разобранный пример',
  contrast_cases: 'Контрастные случаи',
  guided_practice: 'Практика с подсказками',
  independent_practice: 'Самостоятельная практика',
  interleaved_practice: 'Смешанная практика',
  transfer_task: 'Перенос в новую ситуацию',
  reflection: 'Рефлексия',
};

/**
 * Эти типы блоков хранят только вводный текст — сами вопросы живут в
 * `assessments` и решаются в движке практики, не здесь (см. `/review`).
 */
const PRACTICE_BLOCK_TYPES = new Set<ReadingBlock['type']>([
  'pre_assessment',
  'independent_practice',
  'interleaved_practice',
  'transfer_task',
]);

function isCitationKey(value: string | null): value is CitationKey {
  return value !== null && (CITATION_KEYS as readonly string[]).includes(value);
}

export function ContentBlockView({ block, nodeId }: { block: ReadingBlock; nodeId: string }) {
  return (
    <section className="border-t border-border pt-6 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-1.5">
        <h2 className="text-xs font-medium tracking-wide text-fg-muted uppercase">
          {BLOCK_LABEL[block.type]}
        </h2>
        {isCitationKey(block.scienceCitationKey) ? (
          <ScienceHint citation={block.scienceCitationKey} />
        ) : null}
      </div>
      <h3 className="mt-1 text-lg font-medium text-fg">{block.title}</h3>

      <div className="mt-3 text-sm leading-relaxed text-fg-muted">
        <BlockPayload block={block} />
      </div>

      {PRACTICE_BLOCK_TYPES.has(block.type) ? (
        <Button size="sm" variant="secondary" asChild className="mt-4">
          <Link href={{ pathname: '/review', query: { nodeId } }}>
            <Dumbbell aria-hidden />
            Перейти к практике
          </Link>
        </Button>
      ) : null}
    </section>
  );
}

function BlockPayload({ block }: { block: ReadingBlock }) {
  const payload = block.payload;

  switch (payload.kind) {
    case 'prose':
      return (
        <>
          <p className="whitespace-pre-wrap">{payload.markdown}</p>
          {payload.keyPoints && payload.keyPoints.length > 0 ? (
            <ul className="mt-3 flex list-disc flex-col gap-1 pl-5">
              {payload.keyPoints.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          ) : null}
        </>
      );

    case 'worked_example':
      return (
        <>
          <p className="whitespace-pre-wrap font-medium text-fg">{payload.problem}</p>
          <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5">
            {payload.steps.map((step, index) => (
              <li key={index}>
                <p className="text-fg">{step.text}</p>
                <p className="text-xs text-fg-subtle">{step.rationale}</p>
              </li>
            ))}
          </ol>
          <p className="mt-3 rounded-card bg-bg-hover p-3 whitespace-pre-wrap text-fg">
            {payload.solution}
          </p>
        </>
      );

    case 'contrast_cases':
      return (
        <>
          <p>{payload.commonPrinciple}</p>
          <ul className="mt-3 flex flex-col gap-3">
            {payload.cases.map((c, index) => (
              <li key={index} className="rounded-card border border-border p-3">
                <p className="text-xs font-medium text-fg-subtle">{c.context}</p>
                <p className="mt-1 text-fg">{c.example}</p>
                <p className="mt-1 text-xs text-fg-subtle">{c.whyItFits}</p>
              </li>
            ))}
          </ul>
        </>
      );

    case 'guided_practice':
      return (
        <>
          <p className="whitespace-pre-wrap">{payload.task}</p>
          {payload.hints.length > 0 ? (
            <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-fg-subtle">
              {payload.hints.map((hint, index) => (
                <li key={index}>{hint}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-xs text-fg-subtle">Ожидаемый результат: {payload.expectedOutcome}</p>
        </>
      );

    case 'reflection_prompt':
      return (
        <>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {payload.questions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
          {payload.checklist.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1">
              {payload.checklist.map((item, index) => (
                <li key={index} className="flex items-center gap-2 text-xs text-fg-subtle">
                  <span aria-hidden className="size-3 rounded-sm border border-border" />
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      );

    case 'assessment_ref':
      return payload.instructions ? <p>{payload.instructions}</p> : null;
  }
}
