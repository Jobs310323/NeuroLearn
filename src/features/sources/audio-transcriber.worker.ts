/// <reference lib="webworker" />
import { env, pipeline } from '@xenova/transformers';

/**
 * Расшифровка аудио в отдельном потоке браузера.
 *
 * Whisper держит основной поток десятками секунд, поэтому воркер, а не
 * прямой вызов из компонента: без него вкладка перестаёт отвечать на всё
 * время расшифровки, включая отмену.
 *
 * Модель качается с Hugging Face при первом запуске (~40 МБ) и остаётся
 * в кэше браузера. Локальных файлов модели в сборке нет — иначе каждый
 * пользователь тянул бы их вместе с приложением, даже не открыв источники.
 */

env.allowLocalModels = false;

type Request = { audio: Float32Array; language: string };
type Response =
  | { type: 'model'; progress: number }
  | { type: 'text'; text: string }
  | { type: 'error'; message: string };

const worker = self as unknown as DedicatedWorkerGlobalScope;

function reply(message: Response): void {
  worker.postMessage(message);
}

type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text?: string }>;

let transcriberPromise: Promise<Transcriber> | null = null;

function getTranscriber(): Promise<Transcriber> {
  transcriberPromise ??= pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
    progress_callback: (event: { status: string; progress?: number }) => {
      if (event.status === 'progress' && typeof event.progress === 'number') {
        reply({ type: 'model', progress: event.progress });
      }
    },
  }) as unknown as Promise<Transcriber>;
  return transcriberPromise;
}

worker.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const transcriber = await getTranscriber();
    // Кусками по 30 секунд с перекрытием: whisper-tiny принимает ровно 30
    // секунд за раз, а без перекрытия слово на стыке кусков теряется.
    const result = await transcriber(event.data.audio, {
      language: event.data.language,
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    const text = result.text?.trim();
    if (!text) {
      reply({ type: 'error', message: 'Расшифровка вернула пустой текст.' });
      return;
    }
    reply({ type: 'text', text });
  } catch (error) {
    reply({
      type: 'error',
      message: error instanceof Error ? error.message : 'Не удалось расшифровать запись.',
    });
  }
};
