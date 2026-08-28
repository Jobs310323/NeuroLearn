'use client';

import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function LoginForm({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const result = await signIn('owner', {
      login: String(data.get('login') ?? ''),
      password: String(data.get('password') ?? ''),
      redirect: false,
    });

    setPending(false);
    if (result?.error) {
      // Сообщение одно на оба случая: раздельное («такого логина нет» /
      // «пароль неверный») подсказывало бы подбирающему, какая половина пары
      // уже угадана.
      setError('Неверный логин или пароль.');
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login">Логин</Label>
        {/* type="text", а не "email": идентификатором владельца может быть
            обычное имя, и браузер не должен отклонять «admin» как «не почту».
            Почта при этом продолжает работать — её принимает провайдер. */}
        <Input
          id="login"
          name="login"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Пароль</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <Button type="submit" disabled={pending} className="mt-2">
        {pending ? 'Вход…' : 'Войти'}
      </Button>
    </form>
  );
}
