/**
 * Тесты impersonation («вход в кабинет партнёра как партнёр»).
 * Покрывают чистую логику токенов/контекста (без БД):
 *   - createImpersonationToken → токен с act/imp, getAuth отдаёт партнёрский
 *     контекст с actingUserId/impersonating;
 *   - обычный auth_token → impersonating=false, actingUserId=null;
 *   - imp_token приоритетнее auth_token;
 *   - просроченный/битый imp_token → getAuth=null (не молчаливый откат на менеджера);
 *   - verifyImpTokenForRefresh терпит истечение (для продления в refresh).
 */

import { describe, it, expect } from 'vitest'
import { SignJWT } from 'jose'
import type { NextRequest } from 'next/server'
import {
  createAccessToken,
  createImpersonationToken,
  verifyImpTokenForRefresh,
  getAuth,
} from '@/lib/auth'

const MANAGER = '11111111-1111-1111-1111-111111111111'
const PARTNER_TENANT = '22222222-2222-2222-2222-222222222222'
const PARTNER_OWNER = '33333333-3333-3333-3333-333333333333'
const MANAGER_TENANT = '44444444-4444-4444-4444-444444444444'

// Минимальный stub NextRequest: getAuth читает только req.cookies.get(name).value
function reqWithCookies(cookies: Record<string, string>): NextRequest {
  return {
    cookies: {
      get: (name: string) =>
        cookies[name] !== undefined ? { value: cookies[name] } : undefined,
    },
  } as unknown as NextRequest
}

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET!)

describe('impersonation tokens', () => {
  it('createImpersonationToken → getAuth отдаёт партнёрский контекст с actingUserId', async () => {
    const imp = await createImpersonationToken(MANAGER, PARTNER_TENANT, PARTNER_OWNER)
    const auth = await getAuth(reqWithCookies({ imp_token: imp }))
    expect(auth).not.toBeNull()
    expect(auth!.userId).toBe(PARTNER_OWNER)       // от чьего имени — партнёр
    expect(auth!.tenantId).toBe(PARTNER_TENANT)    // контекст тенанта партнёра
    expect(auth!.role).toBe('owner')               // роль не выше владельца партнёра
    expect(auth!.actingUserId).toBe(MANAGER)       // реальный исполнитель — менеджер
    expect(auth!.impersonating).toBe(true)
  })

  it('обычный auth_token → impersonating=false, actingUserId=null', async () => {
    const token = await createAccessToken(MANAGER, MANAGER_TENANT, 'manager')
    const auth = await getAuth(reqWithCookies({ auth_token: token }))
    expect(auth).not.toBeNull()
    expect(auth!.userId).toBe(MANAGER)
    expect(auth!.tenantId).toBe(MANAGER_TENANT)
    expect(auth!.impersonating).toBe(false)
    expect(auth!.actingUserId).toBeNull()
  })

  it('imp_token приоритетнее auth_token', async () => {
    const managerToken = await createAccessToken(MANAGER, MANAGER_TENANT, 'manager')
    const imp = await createImpersonationToken(MANAGER, PARTNER_TENANT, PARTNER_OWNER)
    const auth = await getAuth(reqWithCookies({ auth_token: managerToken, imp_token: imp }))
    expect(auth!.tenantId).toBe(PARTNER_TENANT)
    expect(auth!.impersonating).toBe(true)
  })

  it('просроченный imp_token → getAuth=null (не откат на менеджера)', async () => {
    const managerToken = await createAccessToken(MANAGER, MANAGER_TENANT, 'manager')
    const expiredImp = await new SignJWT({
      uid: PARTNER_OWNER, tid: PARTNER_TENANT, role: 'owner', act: MANAGER, imp: true,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)  // истёк 30 мин назад
      .sign(secret())
    const auth = await getAuth(reqWithCookies({ auth_token: managerToken, imp_token: expiredImp }))
    expect(auth).toBeNull()  // imp-cookie есть, но битый → 401, без тихого отката
  })

  it('битый imp_token (чужая подпись) → getAuth=null', async () => {
    const forged = await new SignJWT({
      uid: PARTNER_OWNER, tid: PARTNER_TENANT, role: 'owner', act: MANAGER, imp: true,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('totally-different-secret-key-not-ours'))
    const auth = await getAuth(reqWithCookies({ imp_token: forged }))
    expect(auth).toBeNull()
  })

  it('verifyImpTokenForRefresh терпит истечение, но проверяет подпись', async () => {
    const expiredImp = await new SignJWT({
      uid: PARTNER_OWNER, tid: PARTNER_TENANT, role: 'owner', act: MANAGER, imp: true,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
      .sign(secret())
    const payload = await verifyImpTokenForRefresh(expiredImp)
    expect(payload).not.toBeNull()
    expect(payload!.act).toBe(MANAGER)
    expect(payload!.imp).toBe(true)

    // чужая подпись не проходит даже в refresh
    const forged = await new SignJWT({ uid: PARTNER_OWNER, tid: PARTNER_TENANT, role: 'owner', act: MANAGER, imp: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('totally-different-secret-key-not-ours'))
    expect(await verifyImpTokenForRefresh(forged)).toBeNull()
  })
})
