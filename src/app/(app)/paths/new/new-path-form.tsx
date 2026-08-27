'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { createLearningPath } from '@/features/learning-path/actions';
import { SCENARIOS } from '@/features/onboarding/lib/tour-steps';
import { cn } from '@/lib/utils';

export function NewPathForm({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Готовый сценарий заполняет поля, но не отправляет форму: цель — вход
   * генератора дерева, и чужая формулировка почти всегда требует правки под
   * себя. Подставить и уйти значило бы построить дерево не под этого человека.
   */
  const [values, setValues] = useState({ title: '', goal: '', targetLevel: '' });

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
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs text-fg-subtle">
          Начать с готового сценария или сформулировать свою цель
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {SCENARIOS.map((scenario) => (
            <Button
              key={scenario.id}
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                setValues({
                  title: scenario.title,
                  goal: scenario.goal,
                  targetLevel: scenario.targetLevel,
                })
              }
            >
              {scenario.title}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setValues({ title: '', goal: '', targetLevel: '' })}
          >
            Своя цель
          </Button>
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Название</Label>
        <Input
          id="title"
          name="title"
          placeholder="Например: TypeScript в продакшене"
          required
          value={values.title}
          onChange={(e) => setValues({ ...values, title: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="goal">Цель</Label>
        <Textarea
          id="goal"
          name="goal"
          rows={4}
          required
          placeholder="Чему научиться и зачем. Чем конкретнее, тем точнее дерево знаний."
          value={values.goal}
          onChange={(e) => setValues({ ...values, goal: e.target.value })}
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
          value={values.targetLevel}
          onChange={(e) => setValues({ ...values, targetLevel: e.target.value })}
        />
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Создание…' : 'Создать путь'}
      </Button>
    </form>
  );
}
