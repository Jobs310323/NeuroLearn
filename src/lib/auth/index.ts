import { eq } from 'drizzle-orm';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';

import { matchesOwner, resolveOwner } from '@/lib/auth/owner';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';

/**
 * Личный режим аутентификации: один владелец, пароль из переменной окружения.
 *
 * Ограничение осознанное — приложение персональное, регистрации нет.
 * GitHub OAuth включается автоматически, если заданы AUTH_GITHUB_ID/SECRET;
 * тогда вход по паролю можно отключить, убрав AUTH_OWNER_PASSWORD.
 *
 * Идентификатор владельца — произвольный логин (`AUTH_OWNER_LOGIN`, по
 * умолчанию `admin`), не обязательно почта; разбор и сравнение вынесены в
 * `owner.ts`, чтобы у скриптов и у входа был один источник правды.
 *
 * Стратегия сессии — JWT: Credentials-провайдер не работает с адаптером БД,
 * поэтому таблиц Auth.js в схеме нет, а `users` наполняется при первом входе.
 */

// Окружение на Vercel не меняется в течение жизни процесса, поэтому разбор
// один раз при загрузке модуля: так решение «включать ли вход по паролю»
// принимается там же, где собирается список провайдеров.
const owner = resolveOwner();

/** Возвращает id пользователя, создавая профиль при первом входе. */
async function ensureUser(email: string, name: string | null): Promise<string> {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true },
  });
  if (existing) return existing.id;

  const [created] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email,
      displayName: name,
      timezone: 'Europe/Moscow',
    })
    .returning({ id: users.id });

  if (!created) throw new Error('Не удалось создать профиль пользователя.');
  return created.id;
}

const providers: NextAuthConfig['providers'] = [];

if (owner.password) {
  providers.push(
    Credentials({
      id: 'owner',
      name: 'Владелец',
      credentials: {
        login: { label: 'Логин', type: 'text' },
        password: { label: 'Пароль', type: 'password' },
      },
      async authorize(raw) {
        // Тип `raw` выводится из объявления `credentials` выше, а принять надо
        // ещё и `email`: форма отправляет `login`, но сохранённые в браузере
        // автозаполнения и внешние клиенты шлют прежнее имя поля.
        const fields = (raw ?? {}) as Record<string, unknown>;
        const identifier =
          typeof fields.login === 'string'
            ? fields.login
            : typeof fields.email === 'string'
              ? fields.email
              : '';
        const password = typeof fields.password === 'string' ? fields.password : '';
        if (!identifier || !password) return null;

        if (!matchesOwner(identifier, password, owner)) return null;

        const id = await ensureUser(owner.email, owner.displayName);
        return { id, email: owner.email, name: owner.displayName };
      },
    }),
  );
}

if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: '/login' },
  callbacks: {
    async signIn({ user, account }) {
      // GitHub: допускаем только владельца. Сверка идёт с `AUTH_OWNER_EMAIL`
      // — служебный адрес вида `admin@neurolearn.local` не совпадёт ни с
      // одним настоящим, и это правильно: без явно указанной почты OAuth не
      // знает, кого считать владельцем.
      if (account?.provider === 'github') {
        if (!user.email || user.email.toLowerCase() !== owner.email) return false;
        user.id = await ensureUser(user.email.toLowerCase(), user.name ?? null);
      }
      return true;
    },
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === 'string') session.user.id = token.uid;
      return session;
    },
  },
});

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
    };
  }
}
