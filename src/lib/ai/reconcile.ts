import { and, eq, lt } from 'drizzle-orm';

import { db } from '@/lib/db';
import { aiGenerations } from '@/lib/db/schema';

/**
 * Строка аудита остаётся `pending`, если функцию убил лимит времени раньше,
 * чем отработал `finishGeneration`. Такие строки не отличить от идущих
 * прямо сейчас, поэтому их закрывают по возрасту: генерация не может идти
 * дольше `maxDuration` route handler'а.
 */
const STALE_AFTER_MS = 6 * 60 * 1000;

export async function reconcileStaleGenerations(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);

  const rows = await db
    .update(aiGenerations)
    .set({
      status: 'provider_failed',
      validationError:
        'Строка закрыта автоматически: осталась в pending дольше предельного времени функции. Скорее всего вызов был прерван лимитом платформы.',
    })
    .where(and(eq(aiGenerations.status, 'pending'), lt(aiGenerations.createdAt, cutoff)))
    .returning({ id: aiGenerations.id });

  return rows.length;
}
