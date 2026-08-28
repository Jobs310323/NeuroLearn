import { describe, expect, it } from 'vitest';

import { DEFAULT_OWNER_LOGIN, matchesOwner, resolveOwner } from './owner';

/**
 * Вход — единственная дверь в приложение, и ошибка здесь не «неудобство»:
 * она либо не пускает владельца, либо пускает кого угодно. Поэтому проверяется
 * не только удачный сценарий, но и совместимость со старой установкой, где
 * логином была почта.
 */
describe('resolveOwner', () => {
  it('без настроек даёт логин admin и служебную почту', () => {
    const owner = resolveOwner({});
    expect(owner.login).toBe(DEFAULT_OWNER_LOGIN);
    expect(owner.email).toBe('admin@neurolearn.local');
    expect(owner.usingDefaultLogin).toBe(true);
  });

  it('без AUTH_OWNER_PASSWORD вход по паролю выключен', () => {
    expect(resolveOwner({}).password).toBeNull();
    expect(resolveOwner({ AUTH_OWNER_PASSWORD: '' }).password).toBeNull();
  });

  it('старая установка с одной лишь почтой продолжает работать', () => {
    const owner = resolveOwner({ AUTH_OWNER_EMAIL: 'me@example.com' });
    expect(owner.login).toBe('me@example.com');
    expect(owner.email).toBe('me@example.com');
    expect(owner.usingDefaultLogin).toBe(false);
  });

  it('при смене логина профиль остаётся привязан к заданной почте', () => {
    // Это и есть защита от «пропали все данные»: новый логин не должен
    // порождать вторую строку в users.
    const owner = resolveOwner({ AUTH_OWNER_LOGIN: 'admin', AUTH_OWNER_EMAIL: 'me@example.com' });
    expect(owner.login).toBe('admin');
    expect(owner.email).toBe('me@example.com');
  });

  it('регистр логина и почты не значим', () => {
    const owner = resolveOwner({ AUTH_OWNER_LOGIN: '  Admin ', AUTH_OWNER_EMAIL: ' Me@Example.COM ' });
    expect(owner.login).toBe('admin');
    expect(owner.email).toBe('me@example.com');
  });

  it('пустая строка в .env.local считается незаданной', () => {
    const owner = resolveOwner({ AUTH_OWNER_LOGIN: '   ', AUTH_OWNER_NAME: '' });
    expect(owner.login).toBe(DEFAULT_OWNER_LOGIN);
    expect(owner.displayName).toBe('Владелец');
  });
});

describe('matchesOwner', () => {
  const owner = resolveOwner({
    AUTH_OWNER_LOGIN: 'admin',
    AUTH_OWNER_EMAIL: 'me@example.com',
    AUTH_OWNER_PASSWORD: 'correct horse battery',
  });

  it('пускает по логину', () => {
    expect(matchesOwner('admin', 'correct horse battery', owner)).toBe(true);
  });

  it('пускает по почте — привычка вводить её не должна сломаться', () => {
    expect(matchesOwner('me@example.com', 'correct horse battery', owner)).toBe(true);
  });

  it('не замечает регистра и пробелов по краям', () => {
    expect(matchesOwner('  ADMIN ', 'correct horse battery', owner)).toBe(true);
  });

  it('не пускает при неверном пароле, даже если логин верный', () => {
    expect(matchesOwner('admin', 'admin', owner)).toBe(false);
  });

  it('не пускает при неверном логине, даже если пароль верный', () => {
    expect(matchesOwner('root', 'correct horse battery', owner)).toBe(false);
  });

  it('регистр пароля значим', () => {
    expect(matchesOwner('admin', 'Correct Horse Battery', owner)).toBe(false);
  });

  it('пустой ввод не совпадает ни с чем', () => {
    expect(matchesOwner('', '', owner)).toBe(false);
  });

  it('без пароля в окружении не пускает никого', () => {
    const disabled = resolveOwner({ AUTH_OWNER_LOGIN: 'admin' });
    expect(matchesOwner('admin', '', disabled)).toBe(false);
    expect(matchesOwner('admin', 'что угодно', disabled)).toBe(false);
  });

  it('служебная почта работает как идентификатор наравне с логином', () => {
    const bare = resolveOwner({ AUTH_OWNER_PASSWORD: 'secret12' });
    expect(matchesOwner('admin@neurolearn.local', 'secret12', bare)).toBe(true);
  });
});
