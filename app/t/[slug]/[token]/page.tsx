import { redirect } from 'next/navigation'

/**
 * Брендированный URL для приглашения родителей:
 *   /t/<tenant_slug>/<child_token>
 *
 * Семантически удобен для маркетинга, визиток, SMS — владелец
 * видит slug своей компании в ссылке. Функционально полностью
 * эквивалентен /<child_token>: tenant всё равно подтягивается
 * по token → child → album → tenant_id, slug в URL игнорируется
 * на стороне сервера.
 */
export default function BrandedTokenRedirect({
  params,
}: {
  params: { slug: string; token: string }
}) {
  redirect(`/${params.token}`)
}
