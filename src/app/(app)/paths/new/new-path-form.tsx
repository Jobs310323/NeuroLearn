'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { createLearningPath } from '@/features/learning-path/actions';
import { cn } from '@/lib/utils';

export function NewPathForm({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const result = await createLearningPath({
      title: String(form.get('title') ?? ''),
      goal: String(form.get('goal') ?? ''),
      targetLevel: String(form.get('targetLevel') ?? '') || undefined,
    });

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }

    router.push(`/paths/${result.data.pathId}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className={cn('flex flex-col gap-5', className)}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Название</Label>
        <Input id="title" name="title" placeholder="Например: TypeScript в продакшене" required />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="goal">Цель</Label>
        <Textarea
          id="goal"
          name="goal"
          rows={4}
          required
          placeholder="Чему научиться и зачем. Чем конкретнее, тем точнее дерево знаний."
        />
        <p className="text-xs text-fg-subtle">
          Формулировка цели — вход для генератора дерева знаний на следующем этапе.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="targetLevel">Целевой уровень (необязательно)</Label>
        <Input
          id="targetLevel"
          name="targetLevel"
          placeholder="Например: писать типобезопасный код без подсказок"
        />
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Создание…' : 'Создать путь'}
      </Button>
    </form>
  );
}
