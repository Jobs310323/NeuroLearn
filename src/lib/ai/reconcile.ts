import { and, eq, lt } from 'drizzle-orm';

import { db } from '@/lib/db';
import { aiGenerations } from '@/lib/db/schema';

/**
 * Строка аудита остаётся `pending`, если функцию убил лимит времени раньше,
 * чем отработал `finishGeneration`. Такие строки не отличить от идущих
 * прямо сейчас, поэтому их закрывают по возрасту.
 *
 * Порог считается от предельной жизни ОДНОЙ строки, а не от `maxDuration`
 * роута: строка заводится на каждый вызов `generateValidated`, а тот делает до
 * двух попыток по `DEFAULT_REQUEST_TIMEOUT_MS` (200 секунд) — около 7 минут в
 * пределе. Прежние 6 минут были короче этого предела, и живой вызов мог быть
 * закрыт как провалившийся: в аудит попадала ложь, а breaker засчитывал
 * `provider_failed` модели, которая в этот момент нормально работала. Заметно
 * это стало на прогоне из CLI — там нет платформенного лимита в 300 секунд,
 * который прежде обрывал вызов раньше порога.
 *
 * Цена запаса — только задержка уборки действительно мёртвых строк.
 */
const STALE_AFTER_MS = 10 * 60 * 1000;

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
