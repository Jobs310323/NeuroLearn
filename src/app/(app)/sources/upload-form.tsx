'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { uploadSource } from '@/features/sources/actions';
import { AudioTranscriber } from '@/features/sources/audio-transcriber';
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
  const textRef = useRef<HTMLTextAreaElement>(null);
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
        <Label htmlFor="file">Файл (.pdf, .md, .txt, .wav — до 4 МБ)</Label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".pdf,.md,.markdown,.txt,.wav"
          className="text-sm text-fg-muted file:mr-3 file:rounded-md file:border-0 file:bg-bg-hover file:px-3 file:py-1.5 file:text-sm file:text-fg"
        />
        <p className="text-xs text-fg-subtle">
          .wav сервер расшифрует сам, но только его: конвертера mp3/m4a в проекте нет. Записи
          в других форматах разбирает кнопка ниже — прямо в браузере.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="text">…или вставьте текст</Label>
        <Textarea
          ref={textRef}
          id="text"
          name="text"
          rows={5}
          placeholder="Вставьте конспект или заметки, если нет файла."
        />
      </div>

      {/*
        Расшифровка кладёт текст в то же поле, а не отправляет отдельно:
        дальше запись ничем не отличается от вставленного конспекта, и
        второй путь загрузки ради неё не нужен. Заодно человек видит
        расшифровку до отправки и может поправить имена и термины.
      */}
      <AudioTranscriber
        onText={(transcript) => {
          const field = textRef.current;
          if (!field) return;
          field.value = field.value ? `${field.value}\n\n${transcript}` : transcript;
          field.focus();
        }}
      />

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Обрабатываю…' : 'Загрузить'}
      </Button>
    </form>
  );
}
