import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';

/**
 * Идентификатор текущего пользователя для серверного кода.
 * Единственный источник `userId` — сессия; из тела запроса он не принимается.
 */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  return session.user.id;
}

/** Вариант для Route Handlers: бросает вместо редиректа. */
export async function requireUserIdOrThrow(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }
  return session.user.id;
}

export class UnauthorizedError extends Error {
  readonly code = 'UNAUTHORIZED';
  constructor() {
    super('Требуется вход.');
  }
}
