import type { WebContainer } from '@webcontainer/api';

/**
 * Прогон кода из сдачи проекта в браузерной песочнице (WebContainer) —
 * реальное выполнение вместо доверия описанию. Работает только в браузере:
 * WebContainer грузит Node.js в WASM внутри вкладки, серверу здесь делать
 * нечего. Требует cross-origin isolation (COOP/COEP), см. `next.config.mjs`.
 *
 * Ограничение: одна страница — один инстанс контейнера (SDK не поддерживает
 * параллельные boot), поэтому инстанс держим в модульной переменной.
 */

export type SandboxRunResult = {
  ran: true;
  exitCode: number;
  output: string;
} | {
  ran: false;
  error: string;
};

const RUN_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_CHARS = 4000;

let containerPromise: Promise<WebContainer> | null = null;

async function getContainer(): Promise<WebContainer> {
  if (!containerPromise) {
    containerPromise = import('@webcontainer/api').then(({ WebContainer }) => WebContainer.boot());
  }
  return containerPromise;
}

/** Код студента — один файл `index.js`, запускается как `node index.js`. */
export async function runInSandbox(code: string): Promise<SandboxRunResult> {
  if (typeof SharedArrayBuffer === 'undefined') {
    return { ran: false, error: 'Браузер не поддерживает cross-origin isolation — песочница недоступна.' };
  }

  try {
    const container = await getContainer();
    await container.mount({ 'index.js': { file: { contents: code } } });

    const process = await container.spawn('node', ['index.js']);
    let output = '';
    process.output.pipeTo(
      new WritableStream({
        write(chunk) {
          if (output.length < MAX_OUTPUT_CHARS) output += chunk;
        },
      }),
    );

    let timeoutId: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        process.kill();
        reject(new Error('Превышено время выполнения (15с).'));
      }, RUN_TIMEOUT_MS);
    });

    const exitCode = await Promise.race([process.exit, timeout]).finally(() => clearTimeout(timeoutId));

    return { ran: true, exitCode, output: output.slice(0, MAX_OUTPUT_CHARS) };
  } catch (error) {
    return { ran: false, error: (error as Error).message };
  }
}
