import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

import { UnauthorizedError } from '@/lib/auth/require-user';

/**
 * Общие формы ответов Route Handlers (контракт `docs/API.md`).
 *
 * Это НЕ middleware и не обёртка над обработчиком: авторизацию по-прежнему
 * вызывает каждый обработчик сам (`requireUserIdOrThrow`), как требует
 * PRD §10. Здесь только сериализация ошибки в единый формат
 * `{ error: { code, message } }` — иначе каждый новый маршрут изобретает свою
 * форму, и клиент разбирает три разных.
 */

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VERSION_CONFLICT'
  | 'RATE_LIMITED'
  | 'DISABLED'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  RATE_LIMITED: 429,
  DISABLED: 503,
  INTERNAL: 500,
};

export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status: STATUS_BY_CODE[code] },
  );
}

export function unauthorized(error: unknown): NextResponse {
  const message = error instanceof UnauthorizedError ? error.message : 'Требуется вход.';
  return apiError('UNAUTHORIZED', message);
}

export function validationFailed(error: ZodError): NextResponse {
  return apiError('VALIDATION_FAILED', 'Некорректный запрос', error.flatten());
}

/**
 * Тело запроса как `unknown`. Пустое или неразбираемое тело — это `null`, а не
 * исключение: дальше его всё равно проверяет Zod, и ошибка должна быть
 * `VALIDATION_FAILED`, а не 500.
 */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
