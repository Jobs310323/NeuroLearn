import { describe, expect, it } from 'vitest';

import { describeDevice } from './device-name';

describe('describeDevice', () => {
  it('различает браузеры, маскирующиеся под Chrome', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 Edg/120',
      ),
    ).toBe('Edge · Windows');
  });

  it('Safari на iPhone не превращается в Chrome', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari · iPhone');
  });

  it('Chrome на Android', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
      ),
    ).toBe('Chrome · Android');
  });

  it('честно признаётся, когда данных нет', () => {
    expect(describeDevice(null)).toBe('Неизвестное устройство');
    expect(describeDevice('')).toBe('Неизвестное устройство');
    expect(describeDevice('curl/8.0')).toBe('Неизвестное устройство');
  });
});
