/**
 * Минимальный писатель ZIP-архива (метод STORE, без сжатия).
 *
 * Зачем свой, а не библиотека: выгрузка тетради — это десяток-другой мелких
 * текстовых файлов, и ради них тянуть зависимость с собственным жизненным
 * циклом невыгодно. Формат ZIP в части STORE — три структуры фиксированной
 * раскладки (APPNOTE.TXT §4.3), они уместились в этот файл целиком.
 *
 * Цена решения названа честно: без сжатия архив примерно равен сумме файлов.
 * Для текста это единицы мегабайт — приемлемо; за пределами тетради этот
 * модуль использовать не стоит.
 */

const encoder = new TextEncoder();

/** CRC-32 (IEEE 802.3) — обязательное поле заголовка, иначе архив «повреждён». */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; content: string };

/**
 * Дата/время в формате MS-DOS. Секунды хранятся с шагом 2 — это ограничение
 * формата, а не потеря точности с нашей стороны.
 */
function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time:
      (Math.floor(date.getSeconds() / 2) & 0x1f) |
      ((date.getMinutes() & 0x3f) << 5) |
      ((date.getHours() & 0x1f) << 11),
    date:
      (date.getDate() & 0x1f) |
      (((date.getMonth() + 1) & 0x0f) << 5) |
      ((Math.max(0, date.getFullYear() - 1980) & 0x7f) << 9),
  };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

/** Флаг бита 11 — имена файлов в UTF-8. Без него кириллица в именах ломается. */
const FLAG_UTF8 = 0x0800;

export function createZip(entries: ZipEntry[], now = new Date()): Uint8Array {
  const { time, date } = dosDateTime(now);
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = encoder.encode(entry.content);
    const checksum = crc32(dataBytes);

    const localHeader = concat([
      u32(0x04034b50), // сигнатура локального заголовка
      u16(20), // минимальная версия
      u16(FLAG_UTF8),
      u16(0), // метод STORE
      u16(time),
      u16(date),
      u32(checksum),
      u32(dataBytes.length),
      u32(dataBytes.length),
      u16(nameBytes.length),
      u16(0), // extra field
      nameBytes,
    ]);

    local.push(localHeader, dataBytes);

    central.push(
      concat([
        u32(0x02014b50), // сигнатура записи центрального каталога
        u16(20), // версия создателя
        u16(20), // минимальная версия
        u16(FLAG_UTF8),
        u16(0),
        u16(time),
        u16(date),
        u32(checksum),
        u32(dataBytes.length),
        u32(dataBytes.length),
        u16(nameBytes.length),
        u16(0),
        u16(0), // комментарий
        u16(0), // номер диска
        u16(0), // внутренние атрибуты
        u32(0), // внешние атрибуты
        u32(offset),
        nameBytes,
      ]),
    );

    offset += localHeader.length + dataBytes.length;
  }

  const centralBytes = concat(central);
  const end = concat([
    u32(0x06054b50), // End of central directory
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBytes.length),
    u32(offset),
    u16(0),
  ]);

  return concat([...local, centralBytes, end]);
}
