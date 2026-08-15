import { WaveFile } from 'wavefile';

/**
 * Расшифровка аудио локальным Whisper (`@xenova/transformers`, ONNX в
 * процессе Node, без внешнего API-ключа — согласуется с политикой проекта
 * «бесплатное и локальное по умолчанию»). Только WAV: `wavefile` умеет
 * декодировать именно этот контейнер, ffmpeg в проекте нет — конвертировать
 * mp3/m4a в PCM нечем.
 *
 * Модель (~40 МБ, `Xenova/whisper-tiny`) скачивается и кэшируется при первом
 * вызове — офлайн из этого процесса не выполнить (сеть нужна один раз).
 */

export class TranscriptionError extends Error {}

let transcriberPromise: Promise<(audio: Float32Array) => Promise<{ text: string }>> | null = null;

async function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = import('@xenova/transformers').then(({ pipeline }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny') as any,
    );
  }
  return transcriberPromise;
}

/** `buffer` — содержимое WAV-файла целиком. Возвращает расшифрованный текст. */
export async function transcribeAudio(buffer: Uint8Array): Promise<string> {
  let wav: WaveFile;
  try {
    wav = new WaveFile(buffer);
  } catch {
    throw new TranscriptionError('Не удалось разобрать файл — ожидается WAV.');
  }

  wav.toBitDepth('32f');
  wav.toSampleRate(16000);
  const samples = wav.getSamples(false, Float32Array);
  const audio = Array.isArray(samples) ? samples[0] : samples;
  if (!audio || audio.length === 0) {
    throw new TranscriptionError('Пустая аудиодорожка.');
  }

  const transcriber = await getTranscriber();
  const result = await transcriber(audio);
  const text = result.text?.trim();
  if (!text) throw new TranscriptionError('Расшифровка вернула пустой текст.');
  return text;
}
