'use client'

import { supabaseBrowser } from '@/lib/supabase-browser'

/**
 * Прямая загрузка файла с клиента по результату серверной «подписи».
 * Сервер (createUploadTarget) возвращает одно из двух:
 *   - { backend:'timeweb', put_url } → обычный PUT в presigned-URL (S3 Timeweb);
 *   - { backend:'supabase'|undefined, path, token } → Supabase uploadToSignedUrl.
 * Так клиент не зависит от того, какой бэкенд хранилища включён на сервере.
 */
export async function uploadViaSignedTarget(
  bucket: string,
  sign: { backend?: string; path?: string; token?: string; put_url?: string },
  file: File,
): Promise<void> {
  if (sign?.backend === 'timeweb' && sign.put_url) {
    const res = await fetch(sign.put_url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    })
    if (!res.ok) throw new Error(`Загрузка не удалась (HTTP ${res.status})`)
    return
  }
  if (!sign?.path || !sign?.token) throw new Error('Ответ подписи без path/token')
  const { error } = await supabaseBrowser.storage
    .from(bucket)
    .uploadToSignedUrl(sign.path, sign.token, file, { contentType: file.type })
  if (error) throw new Error(error.message)
}
