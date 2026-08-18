import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ContentGenerationError, moduleProgress } from '@/lib/ai/agents/content-generator';
import { moduleGenerationStatus } from '@/lib/ai/status';
import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';

/**
 * Состояние сборки модуля для опроса из интерфейса.
 *
 * Два независимых источника, и оба нужны. `moduleProgress` говорит, что уже
 * лежит в базе — то есть какие шаги переживут перезагрузку страницы.
 * `moduleGenerationStatus` говорит, чем закончился последний вызов модели —
 * то есть почему следующий шаг не сдвинулся с места.
 */

const ERROR_STATUS: Record<string, number> = { NOT_FOUND: 404 };

export async function GET(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: error.message } }, { status: 401 });
    }
    throw error;
  }

  const nodeId = new URL(request.url).searchParams.get('nodeId');
  if (!nodeId || !z.string().uuid().safeParse(nodeId).success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Нужен параметр nodeId' } },
      { status: 400 },
    );
  }

  try {
    // Владение проверяет `moduleGenerationStatus`; `moduleProgress` считает
    // только содержимое узла и сам по себе прав не проверяет.
    const status = await moduleGenerationStatus({ userId, nodeId });
    const progress = await moduleProgress(nodeId);

    return NextResponse.json({
      ...status,
      doneSteps: progress.doneSteps,
      nextStep: progress.nextStep,
      blockCount: progress.blockCount,
      assessmentCount: progress.assessmentCount,
    });
  } catch (error) {
    if (error instanceof ContentGenerationError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: ERROR_STATUS[error.code] ?? 500 },
      );
    }
    throw error;
  }
}
