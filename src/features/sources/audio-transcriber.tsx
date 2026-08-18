'use client';

import { Mic } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Расшифровка записи на стороне браузера.
 *
 * Серверный путь остаётся (`src/lib/services/sources/transcribe.ts`), но он
 * дорог и узок: модель заново скачивается при каждом холодном старте функции,
 * из шестидесяти секунд лимита на саму расшифровку остаются считанные, а
 * распознать он умеет только WAV — конвертера в проекте нет.
 *
 * Браузер снимает оба ограничения. Декодирует он всё, что умеет играть
 * (mp3, m4a, ogg, webm), модель кэширует у себя между запусками, а времени
 * ему никто не отмеряет. На сервер уходит уже готовый текст, поэтому
 * ограничение в 4 МБ на тело запроса перестаёт касаться длинных записей.
 */

/** Частота, на которой обучен Whisper. Декодер пересчитывает запись под неё. */
const TARGET_SAMPLE_RATE = 16_000;

/** Дальше расшифровка в браузере идёт дольше, чем человек готов ждать. */
const MAX_DURATION_SECONDS = 15 * 60;

type Stage =
  | { kind: 'idle' }
  | { kind: 'decoding' }
  | { kind: 'model'; progress: number }
  | { kind: 'transcribing' }
  | { kind: 'error'; message: string };

type WorkerMessage =
  | { type: 'model'; progress: number }
  | { type: 'text'; text: string }
  | { type: 'error'; message: string };

/** Смешивание каналов в моно: Whisper принимает одну дорожку. */
function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);

  const mixed = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) mixed[i]! += data[i]! / buffer.numberOfChannels;
  }
  return mixed;
}

export function AudioTranscriber({
  onText,
  className,
}: {
  onText: (text: string) => void;
  className?: string;
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const workerRef = useRef<Worker | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  function ensureWorker(): Worker {
    if (workerRef.current) return workerRef.current;

    const worker = new Worker(new URL('./audio-transcriber.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'model') {
        setStage({ kind: 'model', progress: message.progress });
        return;
      }
      if (message.type === 'text') {
        setStage({ kind: 'idle' });
        onText(message.text);
        return;
      }
      setStage({ kind: 'error', message: message.message });
    };

    worker.onerror = () => {
      setStage({
        kind: 'error',
        message: 'Расшифровка в браузере недоступна. Загрузите WAV — его разберёт сервер.',
      });
    };

    workerRef.current = worker;
    return worker;
  }

  async function handleFile(file: File): Promise<void> {
    setStage({ kind: 'decoding' });

    let audio: Float32Array;
    try {
      // Пересчёт под частоту Whisper делает сам декодер: собственный
      // ресемплер здесь был бы третьей реализацией одного и того же.
      const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      await context.close();

      if (decoded.duration > MAX_DURATION_SECONDS) {
        setStage({
          kind: 'error',
          message: `Запись длиннее ${MAX_DURATION_SECONDS / 60} минут — разрежьте её на части.`,
        });
        return;
      }
      audio = toMono(decoded);
    } catch {
      setStage({
        kind: 'error',
        message: 'Не удалось прочитать запись — браузер не знает этот формат.',
      });
      return;
    }

    setStage({ kind: 'transcribing' });
    // Буфер передаётся владением, а не копией: минуты звука — это десятки
    // мегабайт, и копировать их между потоками незачем.
    ensureWorker().postMessage({ audio, language: 'russian' }, [audio.buffer]);
  }

  const busy = stage.kind === 'decoding' || stage.kind === 'model' || stage.kind === 'transcribing';

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor="audio">Расшифровать запись</Label>

      <input
        ref={inputRef}
        id="audio"
        type="file"
        accept="audio/*"
        disabled={busy}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void handleFile(file);
        }}
      />

      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy}
        className="self-start"
        onClick={() => inputRef.current?.click()}
      >
        <Mic aria-hidden />
        {busy ? 'Расшифровываю…' : 'Выбрать аудиофайл'}
      </Button>

      <p className="text-xs text-fg-subtle" role="status">
        {stage.kind === 'decoding' ? 'Читаю запись…' : null}
        {stage.kind === 'model'
          ? `Загружаю модель распознавания: ${Math.round(stage.progress)}%. Первый раз — около 40 МБ, дальше из кэша.`
          : null}
        {stage.kind === 'transcribing' ? 'Расшифровываю. Вкладку можно не держать активной.' : null}
        {stage.kind === 'idle'
          ? 'Распознавание идёт в браузере: файл никуда не отправляется, формат — любой, который браузер умеет играть.'
          : null}
      </p>

      {stage.kind === 'error' ? <p className="text-xs text-red-400">{stage.message}</p> : null}
    </div>
  );
}
