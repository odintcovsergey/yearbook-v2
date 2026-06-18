/**
 * lib/auth.ts — Авторизация через JWT
 *
 * httpOnly cookie "auth_token" → user с ролью и tenant_id.
 * Legacy-режим (x-admin-secret → superadmin) удалён — F4 аудита безопасности.
 * Поле isLegacy в AuthContext сохранено для совместимости и всегда false.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from './supabase'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

// ============================================================
// ТИПЫ
// ============================================================

export type UserRole = 'superadmin' | 'owner' | 'manager' | 'viewer'

export interface AuthContext {
  userId: string | null        // null для legacy-режима
  tenantId: string             // DEFAULT_TENANT_ID для legacy/superadmin
  role: UserRole
  isLegacy: boolean            // true = вход через x-admin-secret
  // Impersonation («вход как партнёр»): когда сотрудник OkeyBook работает
  // в кабинете партнёра, userId/tenantId/role — партнёрские, а actingUserId —
  // реальный менеджер. При обычной работе actingUserId=null, impersonating=false.
  actingUserId: string | null  // реальный исполнитель (менеджер) при imp
  impersonating: boolean       // true = активна imp-сессия
}

interface JWTData extends JWTPayload {
  uid: string      // user_id
  tid: string      // tenant_id (пустая строка для superadmin)
  role: UserRole
  act?: string     // (imp) id реального менеджера, который импесонирует
  imp?: boolean    // (imp) признак impersonation-токена
}

// ============================================================
// КОНСТАНТЫ
// ============================================================

const JWT_SECRET = () => {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET not set')
  return new TextEncoder().encode(secret)
}

const DEFAULT_TENANT_ID = () => {
  const id = process.env.DEFAULT_TENANT_ID
  if (!id) throw new Error('DEFAULT_TENANT_ID not set')
  return id
}

const ACCESS_TOKEN_TTL = '15m'      // короткоживущий
const REFRESH_TOKEN_TTL_DAYS = 30   // долгоживущий

// ============================================================
// JWT — создание и проверка
// ============================================================

export async function createAccessToken(userId: string, tenantId: string, role: UserRole): Promise<string> {
  return new SignJWT({ uid: userId, tid: tenantId, role } as JWTData)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(JWT_SECRET())
}

export async function verifyAccessToken(token: string): Promise<JWTData | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET())
    return payload as JWTData
  } catch {
    return null
  }
}

// ============================================================
// IMPERSONATION («вход как партнёр»)
// ============================================================
// Imp-токен накладывается ПОВЕРХ обычной сессии менеджера отдельным cookie
// (imp_token), не трогая его auth_token. Контекст внутри токена — партнёрский
// (tid=партнёр, uid=владелец партнёра, role=owner), а act=id менеджера.
// «Выйти из кабинета» = удалить imp_token → getAuth снова берёт auth_token.

export async function createImpersonationToken(
  managerUserId: string,
  partnerTenantId: string,
  partnerOwnerUserId: string,
): Promise<string> {
  return new SignJWT({
    uid: partnerOwnerUserId,
    tid: partnerTenantId,
    role: 'owner',
    act: managerUserId,
    imp: true,
  } as JWTData)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(JWT_SECRET())
}

// Проверка imp-токена ДЛЯ refresh-flow: подпись обязательна (защита от
// подделки tid/uid), но истечение игнорируем в пределах окна refresh — чтобы
// продлить imp-сессию по живой менеджерской refresh-сессии. clockTolerance
// задан равным TTL refresh-токена.
export async function verifyImpTokenForRefresh(token: string): Promise<JWTData | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET(), {
      clockTolerance: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
    })
    return payload as JWTData
  } catch {
    return null
  }
}

// ============================================================
// REFRESH TOKEN — случайный + хранится в БД
// ============================================================

export async function createRefreshToken(userId: string, req: NextRequest): Promise<string> {
  const token = crypto.randomUUID() + '-' + crypto.randomUUID()
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS)

  await supabaseAdmin.from('sessions').insert({
    user_id: userId,
    token,
    ip_address: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown',
    user_agent: req.headers.get('user-agent')?.slice(0, 200) ?? 'unknown',
    expires_at: expiresAt.toISOString(),
  })

  return token
}

export async function validateRefreshToken(token: string) {
  const { data } = await supabaseAdmin
    .from('sessions')
    .select('id, user_id, expires_at')
    .eq('token', token)
    .single()

  if (!data) return null
  if (new Date(data.expires_at) < new Date()) {
    await supabaseAdmin.from('sessions').delete().eq('id', data.id)
    return null
  }
  return data
}

// ============================================================
// ХЕШИРОВАНИЕ ПАРОЛЯ (bcrypt через Web Crypto не нужен — используем простой sha256 + salt)
// Для продакшена рекомендуется bcrypt, но он требует нативного модуля.
// Здесь используем PBKDF2 через Web Crypto API — безопасно и без зависимостей.
// ============================================================

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('')

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  )

  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map(b => b.toString(16).padStart(2, '0')).join('')

  return `pbkdf2:100000:${saltHex}:${hashHex}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, iterStr, saltHex, storedHash] = stored.split(':')
  const iterations = parseInt(iterStr)
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  )

  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map(b => b.toString(16).padStart(2, '0')).join('')

  return hashHex === storedHash
}

// ============================================================
// ГЛАВНАЯ ФУНКЦИЯ — получить AuthContext из запроса
// ============================================================
// Порядок проверки:
// 1. Cookie auth_token → JWT
// 2. Unauthorized

export async function getAuth(req: NextRequest): Promise<AuthContext | null> {
  // Legacy-вход через x-admin-secret удалён (F4 аудита): статический god-key
  // без ротации/аудита. Остался только JWT-режим.

  // 1. Impersonation: imp_token имеет приоритет над auth_token.
  // Если imp-cookie ЕСТЬ, но невалиден/просрочен — НЕ откатываемся молча на
  // менеджерский контекст (иначе запрос внезапно выполнится от имени OkeyBook),
  // а возвращаем null → 401 → фронт обновит токен (refresh продлит imp по живой
  // менеджерской сессии либо удалит imp и вернёт менеджера).
  const impToken = req.cookies.get('imp_token')?.value
  if (impToken) {
    const payload = await verifyAccessToken(impToken)
    if (payload && payload.imp === true && payload.act) {
      return {
        userId: payload.uid,
        tenantId: payload.tid || DEFAULT_TENANT_ID(),
        role: payload.role,
        isLegacy: false,
        actingUserId: payload.act,
        impersonating: true,
      }
    }
    return null
  }

  // 2. Обычная менеджерская/партнёрская сессия.
  const cookieToken = req.cookies.get('auth_token')?.value
  if (cookieToken) {
    const payload = await verifyAccessToken(cookieToken)
    if (payload) {
      return {
        userId: payload.uid,
        tenantId: payload.tid || DEFAULT_TENANT_ID(),
        role: payload.role,
        isLegacy: false,
        actingUserId: null,
        impersonating: false,
      }
    }
  }

  return null
}

// ============================================================
// ХЕЛПЕРЫ ДЛЯ API ROUTES
// ============================================================

/** Требует авторизацию. Возвращает AuthContext или 401-ответ. */
export async function requireAuth(
  req: NextRequest,
  allowedRoles?: UserRole[]
): Promise<AuthContext | NextResponse> {
  const auth = await getAuth(req)

  if (!auth) {
    return NextResponse.json(
      { error: 'Необходима авторизация' },
      { status: 401 }
    )
  }

  if (allowedRoles && !allowedRoles.includes(auth.role)) {
    return NextResponse.json(
      { error: 'Недостаточно прав' },
      { status: 403 }
    )
  }

  return auth
}

/** Проверяет, является ли результат requireAuth ошибкой */
export function isAuthError(result: AuthContext | NextResponse): result is NextResponse {
  return result instanceof NextResponse
}

/** Фильтр tenant_id для SQL-запросов через Supabase */
export function tenantFilter(auth: AuthContext) {
  // Superadmin может смотреть чужие tenant'ы через ?tenant_id=...
  // Остальные — только свой
  return auth.tenantId
}

// ============================================================
// AUDIT LOG
// ============================================================

export async function logAction(
  auth: AuthContext,
  action: string,
  targetType?: string,
  targetId?: string,
  meta?: Record<string, unknown>,
  ipAddress?: string
) {
  try {
    await supabaseAdmin.from('audit_log').insert({
      tenant_id: auth.tenantId,
      user_id: auth.userId,
      // Реальный исполнитель при impersonation (менеджер OkeyBook). При обычной
      // работе = null. Колонка добавляется миграцией audit_log.acting_user_id.
      acting_user_id: auth.actingUserId,
      action,
      target_type: targetType,
      target_id: targetId,
      meta: auth.impersonating ? { ...(meta ?? {}), impersonating: true } : (meta ?? {}),
      ip_address: ipAddress,
    })
  } catch (e) {
    console.error('Audit log error:', e)
  }
}

// ============================================================
// COOKIE HELPERS
// ============================================================

export function setAuthCookies(response: NextResponse, accessToken: string, refreshToken: string) {
  response.cookies.set('auth_token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 15 * 60,  // 15 минут
  })

  response.cookies.set('refresh_token', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',  // только для auth-эндпоинтов
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  })

  return response
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.delete('auth_token')
  response.cookies.delete('refresh_token')
  // Imp-сессия не должна переживать выход/протухание менеджерской сессии.
  response.cookies.delete('imp_token')
  return response
}

// Cookie imp-токена (отдельно от auth_token). Path '/' — чтобы уходил и на
// /api/tenant (рабочие запросы), и на /api/auth (продление в refresh-flow).
export function setImpersonationCookie(response: NextResponse, impToken: string) {
  response.cookies.set('imp_token', impToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 15 * 60,  // как access-токен
  })
  return response
}

export function clearImpersonationCookie(response: NextResponse) {
  response.cookies.delete('imp_token')
  return response
}
