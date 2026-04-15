/**
 * lib/auth.ts — Двойная авторизация
 *
 * Поддерживает ДВА режима одновременно:
 * 1. Legacy: x-admin-secret → superadmin (для текущего фронта)
 * 2. JWT: httpOnly cookie "auth_token" → user с ролью и tenant_id
 *
 * Текущие заказы продолжают работать без изменений.
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
}

interface JWTData extends JWTPayload {
  uid: string      // user_id
  tid: string      // tenant_id (пустая строка для superadmin)
  role: UserRole
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
// 1. x-admin-secret → legacy superadmin
// 2. Cookie auth_token → JWT
// 3. Unauthorized

export async function getAuth(req: NextRequest): Promise<AuthContext | null> {
  // --- Режим 1: Legacy (текущий фронт) ---
  const adminSecret = req.headers.get('x-admin-secret')
  if (adminSecret && adminSecret === process.env.ADMIN_SECRET) {
    return {
      userId: null,
      tenantId: DEFAULT_TENANT_ID(),
      role: 'superadmin',
      isLegacy: true,
    }
  }

  // --- Режим 2: JWT ---
  const cookieToken = req.cookies.get('auth_token')?.value
  if (cookieToken) {
    const payload = await verifyAccessToken(cookieToken)
    if (payload) {
      return {
        userId: payload.uid,
        tenantId: payload.tid || DEFAULT_TENANT_ID(),
        role: payload.role,
        isLegacy: false,
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
      action,
      target_type: targetType,
      target_id: targetId,
      meta: meta ?? {},
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
  return response
}
