/** @type {import('next').NextConfig} */
module.exports = {
  images: { domains: ['*'] },
  experimental: { serverComponentsExternalPackages: [] },
  // Увеличиваем лимит тела запроса для загрузки фото личного разворота (до 10 МБ)
  api: {
    bodyParser: {
      sizeLimit: '11mb',
    },
  },
}
