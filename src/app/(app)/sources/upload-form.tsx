'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { uploadSource } from '@/features/sources/actions';
import { cn } from '@/lib/utils';

export function UploadForm({
  paths,
  className,
}: {
  paths: { id: string; title: string }[];
  className?: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const result = await uploadSource(formData);

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    formRef.current?.reset();
    router.refresh();
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className={cn('flex flex-col gap-4 rounded-card border border-border bg-bg-elevated p-5', className)}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Название</Label>
        <Input id="title" name="title" placeholder="Например: Конспект по RICE" required />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pathId">Путь (необязательно)</Label>
        <select
          id="pathId"
          name="pathId"
          className="h-9 rounded-md border border-border bg-bg px-3 text-sm text-fg"
          defaultValue=""
        >
          <option value="">Не привязывать</option>
          {paths.map((path) => (
            <option key={path.id} value={path.id}>
              {path.title}
            </option>
          ))}
        </select>
        <p className="text-xs text-fg-subtle">
          Привязанный источник генератор модулей использует как основу для узлов этого пути.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="file">Файл (.pdf, .md, .txt — до 4 МБ)</Label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".pdf,.md,.markdown,.txt"
          className="text-sm text-fg-muted file:mr-3 file:rounded-md file:border-0 file:bg-bg-hover file:px-3 file:py-1.5 file:text-sm file:text-fg"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="text">…или вставьте текст</Label>
        <Textarea
          id="text"
          name="text"
          rows={5}
          placeholder="Вставьте конспект или заметки, если нет файла."
        />
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Обрабатываю…' : 'Загрузить'}
      </Button>
    </form>
  );
}
