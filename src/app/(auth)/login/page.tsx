import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';

import { LoginForm } from './login-form';

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.id) redirect('/dashboard');

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">NeuroLearn</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Обучение через практику до автоматизма.
        </p>
        <LoginForm className="mt-8" />
      </div>
    </main>
  );
}
