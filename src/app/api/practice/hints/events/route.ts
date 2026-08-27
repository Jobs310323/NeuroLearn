import { NextResponse } from 'next/server';
import { z } from 'zod';

import { readJson, unauthorized, validationFailed } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { hintEvents } from '@/lib/db/schema';

/**
 * Запись срабатывания подсказки.
 *
 * Отдельный маршрут, а не поле в ответе на задание: подсказка живёт своим
 * жизненным циклом (показана → закрыта или использована через минуту), и
 * привязывать её к ответу значило бы либо терять исход, либо задерживать
 * ответ до решения человека.
 *
 * Наружу уходят только идентификаторы и числа, при которых сработало
 * правило. Тексты ответов и заметок сюда не попадают.
 */
const eventSchema = z.object({
  ruleId: z.string().trim().min(1).max(64),
  outcome: z.enum(['shown', 'dismissed', 'acted', 'muted']),
  sessionId: z.uuid().nullish(),
  nodeId: z.uuid().nullish(),
  itemIndex: z.number().int().min(-1).max(500).default(0),
  trigger: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export async function POST(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const parsed = eventSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error);

  await db.insert(hintEvents).values({
    userId,
    ruleId: parsed.data.ruleId,
    outcome: parsed.data.outcome,
    sessionId: parsed.data.sessionId ?? null,
    nodeId: parsed.data.nodeId ?? null,
    // Индекс -1 (подсказка до первого задания) хранится нулём: колонка
    // считает пройденные задания, а «до начала» — это ноль.
    itemIndex: Math.max(0, parsed.data.itemIndex),
    trigger: parsed.data.trigger,
  });

  return NextResponse.json({ logged: true }, { status: 201 });
}
