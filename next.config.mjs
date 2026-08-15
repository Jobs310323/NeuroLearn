/**
 * Конфиг в .mjs, а не .ts: загрузчик next.config.ts резолвит typescript
 * относительно текущей рабочей директории, и при запуске из другой папки
 * подхватывает чужой пакет. JS-конфиг лишён этой зависимости.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  typedRoutes: true,
  serverExternalPackages: ['@neondatabase/serverless', '@xenova/transformers'],
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
  // Cross-origin isolation только под /projects — там нужен WebContainer
  // (песочница для сдачи проекта, требует SharedArrayBuffer). Остальному
  // приложению (next-auth, стриминг тьютора) эти заголовки не нужны и могут
  // мешать, поэтому не ставим их глобально.
  async headers() {
    return [
      {
        source: '/projects/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
};

export default nextConfig;
