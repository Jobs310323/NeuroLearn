import { describe, expect, it } from 'vitest';

import { calendarToken, verifyCalendarToken } from './token';

const SECRET = 'тестовый-секрет';
const USER = '11111111-2222-3333-4444-555555555555';

describe('calendarToken', () => {
  it('токен проверяется своим же секретом', () => {
    const token = calendarToken(USER, SECRET);
    expect(verifyCalendarToken(token, SECRET)).toBe(USER);
  });

  it('чужой секрет не подходит — смена секрета отзывает все ссылки разом', () => {
    const token = calendarToken(USER, SECRET);
    expect(verifyCalendarToken(token, 'другой секрет')).toBeNull();
  });

  it('подделанная подпись отвергается', () => {
    const token = calendarToken(USER, SECRET);
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
    expect(verifyCalendarToken(tampered, SECRET)).toBeNull();
  });

  it('подмена пользователя при той же подписи не проходит', () => {
    const token = calendarToken(USER, SECRET);
    const signature = token.split('.')[1]!;
    expect(verifyCalendarToken(`99999999-2222-3333-4444-555555555555.${signature}`, SECRET)).toBeNull();
  });

  it('мусор вместо токена не роняет проверку', () => {
    expect(verifyCalendarToken('', SECRET)).toBeNull();
    expect(verifyCalendarToken('.', SECRET)).toBeNull();
    expect(verifyCalendarToken('без-точки', SECRET)).toBeNull();
    expect(verifyCalendarToken(`${USER}.короткая`, SECRET)).toBeNull();
  });

  it('токен детерминирован: ссылка не меняется между визитами', () => {
    expect(calendarToken(USER, SECRET)).toBe(calendarToken(USER, SECRET));
  });
});
