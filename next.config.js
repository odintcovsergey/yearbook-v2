/** @type {import('next').NextConfig} */
module.exports = {
  // @napi-rs/canvas — нативный бинарник (.node), pdfjs-dist — тяжёлый legacy-бандл:
  // оба используются ТОЛЬКО на сервере (растеризация PDF→JPG в типографском
  // экспорте). Внешние — чтобы webpack не пытался их бандлить (иначе падает на
  // .node) и они require'ились в рантайме.
  experimental: {
    serverComponentsExternalPackages: ['@napi-rs/canvas', 'pdfjs-dist'],
    // Включает instrumentation.ts register() — fail-fast барьер на STORAGE_BACKEND
    // при старте сервера в проде (см. instrumentation.ts).
    instrumentationHook: true,
  },
  // Увеличиваем лимит тела запроса для загрузки фото личного разворота (до 10 МБ)
  api: {
    bodyParser: {
      sizeLimit: '11mb',
    },
  },
  // Защитные заголовки (I1). CSP пока не ставим — требует отдельной выверки,
  // чтобы не сломать inline-стили/скрипты Next и канвас.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ]
  },
}
