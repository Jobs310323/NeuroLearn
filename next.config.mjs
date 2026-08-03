/**
 * Конфиг в .mjs, а не .ts: загрузчик next.config.ts резолвит typescript
 * относительно текущей рабочей директории, и при запуске из другой папки
 * подхватывает чужой пакет. JS-конфиг лишён этой зависимости.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  typedRoutes: true,
  serverExternalPackages: ['@neondatabase/serverless'],
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;
