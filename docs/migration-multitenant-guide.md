# Миграция admin/route.ts — пошаговый гайд

## Принцип: «двойные рельсы»

Текущий фронт (`app/admin/page.tsx`) отправляет заголовок `x-admin-secret`.
Новый фронт (будущий) будет использовать JWT в cookie.
**Оба работают одновременно.**

---

## Шаг 1: Заменить `checkAdmin` на `requireAuth`

### БЫЛО:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, getPhotoUrl } from '@/lib/supabase'

function checkAdmin(req: NextRequest) {
  return req.headers.get('x-admin-secret') === process.env.ADMIN_SECRET
}

export async function GET(req: NextRequest) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'Нет доступа' }, { status: 401 })
  // ...
}
```

### СТАЛО:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, getPhotoUrl } from '@/lib/supabase'
import { requireAuth, isAuthError, type AuthContext } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthError(auth)) return auth  // 401 или 403 — прокидываем как есть
  // auth — это AuthContext с tenantId, role, userId
  // ...
}
```

**Что это даёт:**
- `x-admin-secret` → auth.role = 'superadmin', auth.tenantId = DEFAULT_TENANT_ID
- JWT cookie → auth.role из токена, auth.tenantId из токена
- Текущий фронт **продолжает работать** — он отправляет x-admin-secret как раньше

---

## Шаг 2: Добавить фильтр tenant_id к запросам

### БЫЛО (albums):
```typescript
if (action === 'albums') {
  const { data } = await supabaseAdmin
    .from('albums')
    .select('*')
    .order('created_at', { ascending: false })
  return NextResponse.json(data ?? [])
}
```

### СТАЛО:
```typescript
if (action === 'albums') {
  let query = supabaseAdmin
    .from('albums')
    .select('*')
    .order('created_at', { ascending: false })

  // Superadmin видит все альбомы, остальные — только свои
  if (auth.role !== 'superadmin') {
    query = query.eq('tenant_id', auth.tenantId)
  }

  const { data } = await query
  return NextResponse.json(data ?? [])
}
```

**Почему superadmin видит всё:** вы — superadmin, вам нужно видеть альбомы
всех партнёров. Но партнёр (owner/manager) видит только свои.

**Для текущего фронта ничего не меняется:** legacy-вход через x-admin-secret
автоматически получает role='superadmin', значит фильтр не применяется,
и вы видите те же данные, что и раньше.

---

## Шаг 3: Добавить tenant_id при создании

### БЫЛО:
```typescript
if (body.action === 'create_album') {
  const { data } = await supabaseAdmin.from('albums').insert({
    title: body.title,
    cover_mode: body.cover_mode,
    // ...
  }).select().single()
  return NextResponse.json(data)
}
```

### СТАЛО:
```typescript
if (body.action === 'create_album') {
  const { data } = await supabaseAdmin.from('albums').insert({
    tenant_id: auth.tenantId,  // ← единственное добавление
    title: body.title,
    cover_mode: body.cover_mode,
    // ...
  }).select().single()
  return NextResponse.json(data)
}
```

---

## Шаг 4: Ограничить опасные действия по ролям

### БЫЛО:
```typescript
if (body.action === 'delete_album') {
  // удаление
}
```

### СТАЛО:
```typescript
if (body.action === 'delete_album') {
  if (auth.role === 'viewer') {
    return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
  }

  // Проверяем, что альбом принадлежит tenant'у пользователя
  if (auth.role !== 'superadmin') {
    const { data: album } = await supabaseAdmin
      .from('albums')
      .select('tenant_id')
      .eq('id', body.album_id)
      .single()
    if (album?.tenant_id !== auth.tenantId) {
      return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
    }
  }

  // ... далее существующий код удаления
}
```

---

## Шаг 5: Шаблоны — глобальные + tenant-specific

### БЫЛО:
```typescript
if (action === 'templates') {
  const { data } = await supabaseAdmin
    .from('album_templates')
    .select('*')
    .order('created_at')
  return NextResponse.json(data ?? [])
}
```

### СТАЛО:
```typescript
if (action === 'templates') {
  const { data } = await supabaseAdmin
    .from('album_templates')
    .select('*')
    .or(`tenant_id.is.null,tenant_id.eq.${auth.tenantId}`)
    .order('created_at')
  return NextResponse.json(data ?? [])
}
```
Партнёр видит глобальные шаблоны (tenant_id=null) + свои собственные.

---

## Хелпер: проверка владения альбомом

Часто нужно убедиться, что альбом принадлежит текущему tenant'у.
Вынесем в отдельную функцию:

```typescript
async function assertAlbumAccess(auth: AuthContext, albumId: string) {
  if (auth.role === 'superadmin') return true

  const { data } = await supabaseAdmin
    .from('albums')
    .select('tenant_id')
    .eq('id', albumId)
    .single()

  return data?.tenant_id === auth.tenantId
}
```

Использование:
```typescript
if (action === 'children' && albumId) {
  if (!(await assertAlbumAccess(auth, albumId))) {
    return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
  }
  // ... далее существующий код
}
```

---

## Что НЕ меняется

- **Родительские эндпоинты** (`/api/child`, `/api/select`, `/api/draft`,
  `/api/quote`, `/api/teacher`, `/api/referral`) — работают по access_token
  ученика/учителя, авторизация через `x-admin-secret` не используется.
  Эти файлы трогать НЕ НУЖНО.

- **Страница родителя** (`app/[token]/page.tsx`) — работает по токену,
  не меняется.

- **Структура storage** — S3-пути остаются прежними.

---

## Порядок миграции эндпоинтов (приоритет)

1. `GET albums_with_stats` — главный экран админки
2. `GET templates` — шаблоны
3. `POST create_album` — добавить tenant_id
4. `POST delete_album` — проверка владения
5. Все остальные GET-actions — добавить фильтр
6. Все остальные POST-actions — добавить проверку владения
7. `upload-photo/route.ts` — такой же паттерн (заменить checkAdmin)
8. `register-photo/route.ts` — аналогично

---

## Новые env-переменные (добавить в Vercel)

```
JWT_SECRET=<случайная строка 64+ символа>
DEFAULT_TENANT_ID=<UUID из select id from tenants where slug='main'>
```

ADMIN_SECRET — НЕ удалять! Он продолжает работать для текущего фронта.
