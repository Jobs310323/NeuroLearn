import { FlatCompat } from '@eslint/eslintrc';
import tseslint from 'typescript-eslint';

/**
 * Flat config: `next lint` объявлен устаревшим в Next 15 и удаляется в 16,
 * плюс без конфига он уходил в интерактивный вопрос и не проверял ничего.
 *
 * `eslint-config-next` пока публикуется в старом формате, поэтому
 * подключается через `FlatCompat`.
 */

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default tseslint.config(
  {
    ignores: ['.next/**', 'node_modules/**', 'drizzle/**', 'next-env.d.ts', 'public/sw.js'],
  },
  ...compat.extends('next/core-web-vitals'),
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_`-префикс — принятая в проекте пометка намеренно неиспользуемого аргумента.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // В скриптах и тестах `any` встречается по делу: сырые строки БД, моки.
    files: ['scripts/**/*.ts', 'src/**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
