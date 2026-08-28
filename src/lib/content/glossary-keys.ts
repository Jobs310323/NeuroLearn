/**
 * Ключи глоссария — вынесены из `glossary-term.tsx` намеренно.
 *
 * Тот файл помечен `'use client'` (использует Radix Tooltip). Серверный
 * компонент, импортирующий из клиентского модуля именованное значение,
 * а не компонент, получает на сервере клиентскую ссылку-заглушку вместо
 * настоящего массива — `GLOSSARY_KEYS.map` падает с «is not a function».
 * Простые данные живут здесь, в модуле без директивы, и импортируются
 * обеими сторонами напрямую.
 */
export const GLOSSARY_KEYS = [
  'interleaving',
  'jok',
  'calibration',
  'strength',
  'automaticity',
  'fsrs',
] as const;

export type GlossaryKey = (typeof GLOSSARY_KEYS)[number];
