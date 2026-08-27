import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError, readJson, unauthorized, validationFailed } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { withPreferenceDefaults } from '@/lib/db/schema/types';

/**
 * Настройки подсказок: мастер-выключатель и отключение отдельных типов.
 *
 * «Больше не показывать этот тип» из карточки приходит сюда же (`disableRule`)
 * — иначе отключение жило бы только до конца сессии, а человек ждал, что
 * навсегда. Обратная операция (`enableRule`) есть в настройках: выключить
 * что-то одним кликом и не иметь способа вернуть — это ловушка, а не выбор.
 */
const RULE_IDS = [
  'rest_suggestion',
  'metacognitive_coaching',
  'contrast_mode_offer',
  'difficulty_indicator',
  'capture_nudge',
  'review_before_session',
] as const;

const hintsSchema = z.object({
  enabled: z.boolean().optional(),
  disableRule: z.enum(RULE_IDS).optional(),
  enableRule: z.enum(RULE_IDS).optional(),
  /** Полная замена списка — используется экраном настроек. */
  disabledRules: z.array(z.enum(RULE_IDS)).optional(),
});

export async function GET(): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { preferences: true },
  });
  if (!user) return apiError('NOT_FOUND', 'Профиль не найден.');

  return NextResponse.json({
    ...withPreferenceDefaults(user.preferences).hints,
    availableRules: RULE_IDS,
  });
}

export async function POST(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const parsed = hintsSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { preferences: true },
  });
  if (!user) return apiError('NOT_FOUND', 'Профиль не найден.');

  const preferences = withPreferenceDefaults(user.preferences);
  const disabled = new Set(preferences.hints.disabledRules);

  if (parsed.data.disabledRules) {
    disabled.clear();
    for (const rule of parsed.data.disabledRules) disabled.add(rule);
  }
  if (parsed.data.disableRule) disabled.add(parsed.data.disableRule);
  if (parsed.data.enableRule) disabled.delete(parsed.data.enableRule);

  const hints = {
    enabled: parsed.data.enabled ?? preferences.hints.enabled,
    disabledRules: [...disabled],
  };

  await db
    .update(users)
    .set({ preferences: { ...preferences, hints }, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return NextResponse.json(hints);
}
