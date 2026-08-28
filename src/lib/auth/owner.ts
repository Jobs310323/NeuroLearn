import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Учётные данные владельца — в одном месте.
 *
 * Раньше вход был жёстко привязан к почте: поле формы `type="email"`, браузер
 * не давал отправить «admin», а провайдер сравнивал строку с `AUTH_OWNER_EMAIL`.
 * Для персональной установки это лишнее требование — владелец знает, кто он,
 * и почта здесь была не идентификатором, а формальностью.
 *
 * Теперь идентификатор — произвольная строка (`AUTH_OWNER_LOGIN`, по умолчанию
 * `admin`), а почта остаётся, потому что она нужна двум местам: колонке
 * `users.email` (NOT NULL) и проверке владельца при входе через GitHub OAuth.
 * Если `AUTH_OWNER_EMAIL` задана, профиль привязывается к ней — это важно для
 * уже работающей установки: смена логина не должна создать пустой профиль и
 * выглядеть как потеря всей истории обучения.
 *
 * Пароль по умолчанию НЕ задаётся сознательно. Значение из репозитория — это
 * значение, опубликованное вместе с репозиторием; для приложения, доступного
 * по адресу в интернете, «пароль по умолчанию» означает «входа нет».
 * Без `AUTH_OWNER_PASSWORD` вход по паролю просто не включается, и
 * `npm run check-env` говорит об этом прямо.
 */

/** Логин, если `AUTH_OWNER_LOGIN` не задана. Имя пользователя — не секрет. */
export const DEFAULT_OWNER_LOGIN = 'admin';

/**
 * Домен для служебной почты, когда логин не почта. `.local` зарезервирован
 * RFC 6762 и гарантированно не пересечётся с настоящим адресом.
 */
const FALLBACK_EMAIL_DOMAIN = 'neurolearn.local';

export type OwnerCredentials = {
  /** Что человек вводит в поле «Логин». Всегда в нижнем регистре. */
  login: string;
  /** `null` — вход по паролю выключен (переменная не задана). */
  password: string | null;
  /** Адрес для строки в `users` и для сверки при входе через GitHub. */
  email: string;
  displayName: string;
  /** Логин остался значением по умолчанию — повод предупредить в check-env. */
  usingDefaultLogin: boolean;
};

type Env = Record<string, string | undefined>;

/** Пустая строка в `.env.local` — это «не задано», а не «задано пустым». */
function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveOwner(env: Env = process.env): OwnerCredentials {
  const configuredLogin = clean(env.AUTH_OWNER_LOGIN);
  const configuredEmail = clean(env.AUTH_OWNER_EMAIL)?.toLowerCase();

  // Порядок важен: установка, где задана только почта, продолжает работать
  // ровно как раньше — почта и есть логин.
  const login = (configuredLogin ?? configuredEmail ?? DEFAULT_OWNER_LOGIN).toLowerCase();

  const email =
    configuredEmail ?? (login.includes('@') ? login : `${login}@${FALLBACK_EMAIL_DOMAIN}`);

  return {
    login,
    password: env.AUTH_OWNER_PASSWORD || null,
    email,
    displayName: clean(env.AUTH_OWNER_NAME) ?? 'Владелец',
    usingDefaultLogin: configuredLogin === undefined && configuredEmail === undefined,
  };
}

/**
 * Сравнение фиксированной длины: SHA-256 приводит строки любой длины к 32
 * байтам, поэтому `timingSafeEqual` не бросает исключение на разной длине и
 * само время сравнения не выдаёт, насколько ввод близок к правильному.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Проверка пары «идентификатор + пароль».
 *
 * Идентификатором считается и логин, и почта: человек, привыкший вводить
 * почту, не должен обнаружить, что вход сломался после обновления.
 */
export function matchesOwner(
  identifier: string,
  password: string,
  owner: OwnerCredentials,
): boolean {
  if (!owner.password) return false;

  const id = identifier.trim().toLowerCase();

  // Все три сравнения выполняются всегда. `||` замкнулся бы на первом
  // истинном, и разница во времени ответа сообщала бы, какая именно половина
  // пары угадана, — ровно то, что constant-time сравнение и должно скрывать.
  const byLogin = safeEqual(id, owner.login);
  const byEmail = safeEqual(id, owner.email);
  const byPassword = safeEqual(password, owner.password);

  return (byLogin || byEmail) && byPassword;
}
