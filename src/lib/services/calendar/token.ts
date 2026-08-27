import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Подписанный токен календарной ленты.
 *
 * Календарные клиенты не умеют логиниться — они ходят по ссылке фоновым
 * процессом, — поэтому лента защищена подписью, а не сессией:
 *
 *   token = userId.HMAC-SHA256(userId, AUTH_SECRET)
 *
 * Подпись вместо случайной строки в базе: токен не нужно хранить, отзыв
 * делается сменой секрета (разом для всех выданных ссылок), а угадать его
 * нельзя. Ссылка при этом остаётся секретом — кто ею владеет, видит
 * расписание, — и в интерфейсе она подписана именно так.
 */
export function calendarToken(userId: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(userId).digest('hex').slice(0, 32);
  return `${userId}.${signature}`;
}

/** `null` — подпись не сошлась. Причину наружу не сообщаем: это лишний сигнал подбирающему. */
export function verifyCalendarToken(token: string, secret: string): string | null {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const userId = token.slice(0, separator);
  const provided = token.slice(separator + 1);
  const expected = createHmac('sha256', secret).update(userId).digest('hex').slice(0, 32);

  // Сравнение постоянного времени: обычное `===` на секрете утекает его
  // побайтно через тайминг. Здесь это скорее гигиена, чем реальная угроза,
  // но правило дешевле соблюдать, чем выяснять исключения.
  if (provided.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected)) ? userId : null;
}
