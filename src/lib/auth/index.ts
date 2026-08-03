import { createHash, timingSafeEqual } from 'node:crypto';

import { eq } from 'drizzle-orm';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';

import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';

/**
 * Личный режим аутентификации: один владелец, пароль из переменной окружения.
 *
 * Ограничение осознанное — приложение персональное, регистрации нет.
 * GitHub OAuth включается автоматически, если заданы AUTH_GITHUB_ID/SECRET;
 * тогда вход по паролю можно отключить, убрав AUTH_OWNER_PASSWORD.
 *
 * Стратегия сессии — JWT: Credentials-провайдер не работает с адаптером БД,
 * поэтому таблиц Auth.js в схеме нет, а `users` наполняется при первом входе.
 */

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

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

if (process.env.AUTH_OWNER_EMAIL && process.env.AUTH_OWNER_PASSWORD) {
  providers.push(
    Credentials({
      id: 'owner',
      name: 'Владелец',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Пароль', type: 'password' },
      },
      async authorize(raw) {
        const email = typeof raw?.email === 'string' ? raw.email.trim().toLowerCase() : '';
        const password = typeof raw?.password === 'string' ? raw.password : '';
        if (!email || !password) return null;

        const ownerEmail = process.env.AUTH_OWNER_EMAIL!.trim().toLowerCase();
        const ownerPassword = process.env.AUTH_OWNER_PASSWORD!;
        if (!safeEqual(email, ownerEmail) || !safeEqual(password, ownerPassword)) {
          return null;
        }

        const id = await ensureUser(ownerEmail, process.env.AUTH_OWNER_NAME ?? null);
        return { id, email: ownerEmail, name: process.env.AUTH_OWNER_NAME ?? 'Владелец' };
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
      // GitHub: допускаем только владельца.
      if (account?.provider === 'github') {
        const owner = process.env.AUTH_OWNER_EMAIL?.trim().toLowerCase();
        if (!user.email || !owner || user.email.toLowerCase() !== owner) return false;
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
