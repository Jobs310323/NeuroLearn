import { describe, expect, it } from 'vitest';

import { isActiveNav } from './active';

describe('isActiveNav', () => {
  it('подсвечивает точное совпадение', () => {
    expect(isActiveNav('/dashboard', '/dashboard')).toBe(true);
  });

  it('подсвечивает раздел на вложенной странице', () => {
    expect(isActiveNav('/paths/1f2e/nodes/abc', '/paths')).toBe(true);
    expect(isActiveNav('/notes/abc', '/notes')).toBe(true);
  });

  it('не подсвечивает раздел с общим префиксом имени', () => {
    expect(isActiveNav('/notebook', '/notes')).toBe(false);
    expect(isActiveNav('/reviewer', '/review')).toBe(false);
  });

  it('корень не активирует разделы', () => {
    expect(isActiveNav('/', '/dashboard')).toBe(false);
  });
});
