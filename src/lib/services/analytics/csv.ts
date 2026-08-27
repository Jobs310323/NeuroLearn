/**
 * Сборка CSV для режима «эксперт».
 *
 * Экранирование вынесено в чистую функцию не из педантизма: в учебных данных
 * встречаются запятые (формулировки заданий), переводы строк (свободные
 * ответы) и кавычки — каждый из трёх ломает CSV по-своему, и ломает молча:
 * файл открывается, просто со съехавшими столбцами.
 *
 * Формат — RFC 4180: разделитель-запятая, кавычки удваиваются, поле с
 * запятой/кавычкой/переводом строки берётся в кавычки целиком.
 */

export type CsvValue = string | number | boolean | Date | null | undefined;

export function escapeCsvField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();

  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: Record<string, CsvValue>[], columns?: string[]): string {
  const headers = columns ?? (rows.length > 0 ? Object.keys(rows[0]!) : []);
  if (headers.length === 0) return '';

  const lines = [headers.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvField(row[header])).join(','));
  }

  // CRLF по RFC 4180: Excel на Windows иначе склеивает строки.
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * BOM в начале файла. Без него Excel читает UTF-8 как локальную кодировку, и
 * кириллица превращается в набор символов — жалоба, за которой стоит не
 * ошибка в данных, а отсутствие трёх байт.
 */
export const UTF8_BOM = '﻿';
