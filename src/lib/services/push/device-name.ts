/**
 * Человекочитаемое имя устройства из User-Agent.
 *
 * Разбор нарочно грубый и без библиотеки: задача не в точной
 * идентификации браузера, а в том, чтобы человек в списке подписок отличил
 * «Chrome · Android» от «Safari · iPhone» и отозвал нужную. Точность здесь
 * не стоит ни зависимости, ни постоянного сопровождения таблиц UA.
 *
 * Порядок проверок значим: Edge и Opera представляются Chrome-ом, Chrome —
 * Safari-ем, поэтому частные случаи идут раньше общих.
 */

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\//, 'Opera'],
  [/\bYaBrowser\//, 'Яндекс.Браузер'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\//, 'Chrome'],
  [/\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const PLATFORMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

function match(pairs: [RegExp, string][], userAgent: string): string | null {
  for (const [pattern, name] of pairs) {
    if (pattern.test(userAgent)) return name;
  }
  return null;
}

/** `null` на входе — устройство подписалось до появления колонки `user_agent`. */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Неизвестное устройство';

  const browser = match(BROWSERS, userAgent);
  const platform = match(PLATFORMS, userAgent);

  if (browser && platform) return `${browser} · ${platform}`;
  return browser ?? platform ?? 'Неизвестное устройство';
}
