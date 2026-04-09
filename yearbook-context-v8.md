# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов
# Обновлено: 09.04.2026 (вечер)

---

## КТО Я И ЧТО МЫ ДЕЛАЕМ

Фотограф/организатор выпускных альбомов. Штат фотографов + внешние фотографы.
Веб-система для отбора фотографий родителями вместо Google Диска.

---

## ТИП АЛЬБОМА — «УНИВЕРСАЛ»

Структура: Обложка → Учителя → Личные страницы → Общий раздел (вне системы)

Правила фото:
- Портреты: общий пул класса, 1 портрет = 1 ребёнок, серые у других
- Групповые: то же, 1 фото = 1 ребёнок
- Планируется вариант где одно фото → несколько учеников

---

## СЦЕНАРИЙ РОДИТЕЛЯ (6 шагов)

Шаг 1 — Портрет (общий пул, блокировка, лайтбокс)
Шаг 2 — Обложка (cover_mode: none/same/optional/required, доплата)
Шаг 3 (id=4) — Фото с друзьями (2 фото, блокировка)
Шаг 4 (id=3) — Текст (до 500 символов) — ПОСЛЕ групповых фото
Шаг 5 — Телефон + имя ("Сообщим когда альбом будет готов")
Шаг 6 — Подтверждение

ВХОД: /album/[albumId] → список учеников → выбор → /[token]
Ответственный: /teacher/[token]

---

## СТЕК

- Next.js 14 + TypeScript + Tailwind
- Supabase (PostgreSQL + Storage)
- Vercel: https://yearbook-v2.vercel.app
- browser-image-compression (maxSizeMB: 1.5, maxWidthOrHeight: 2048)

---

## ССЫЛКИ

- Сайт: https://yearbook-v2.vercel.app
- Админка: https://yearbook-v2.vercel.app/admin
- Supabase: https://bnotiyhamfyllcrqwquq.supabase.co

Тестовый альбом: "Тукей"
album_id: d57b2207-42f2-4ff1-916c-4e01de1cff7d
Ссылка на класс: https://yearbook-v2.vercel.app/album/d57b2207-42f2-4ff1-916c-4e01de1cff7d
Ответственный token: b149747dcaf8bf42feb8d5d938f0fd77

Legacy ключи Supabase: Settings → API Keys → "Legacy anon, service_role API keys"

Storage policy (уже создана):
  create policy "Allow public uploads" on storage.objects
  for insert to anon with check (bucket_id = 'photos');

ВАЖНО: Supabase кешировал запросы — исправлено через:
  global: { fetch: (url, opts) => fetch(url, { ...opts, cache: 'no-store' }) }
  в lib/supabase.ts для supabaseAdmin клиента

---

## СТРУКТУРА ПРОЕКТА

~/Desktop/yearbook-v2/

app/
  album/[albumId]/page.tsx        — список учеников ✓
  [token]/page.tsx                — интерфейс родителя ✓
  teacher/[token]/page.tsx        — учителя ✓
  admin/page.tsx                  — админка ✓
  api/
    album/route.ts                ✓
    child/route.ts                ✓
    select/route.ts               ✓
    teacher/route.ts              ✓
    admin/route.ts                ✓
    admin/register-photo/route.ts ✓
    draft/route.ts                ✓

---

## ЧТО РАБОТАЕТ ✓

1. Общая ссылка на класс + кнопка в обзоре админки
2. Адаптивная сетка: телефон 2-3 кол., планшет 3-4, монитор 5 колонок (lg:grid-cols-5)
3. Лайтбокс: стрелки, свайп, миниатюры w-20 h-20 по центру, кнопка выбрать
4. maxHeight лайтбокса: calc(100vh - 220px)
5. Выбор через + на миниатюре И через лайтбокс
6. Мгновенный отклик (will-change: transform + setTimeout для lockPhoto)
7. Блокировки с оптимистичным обновлением
8. Автосохранение (портрет, групповые, текст, обложка, шаг)
9. Страница ошибки с кнопками "Назад" и "Попробовать снова"
10. Страница учителей с лайтбоксом, миниатюрами w-20 h-20, кнопка выбрать
11. Загрузка фото со сжатием (1.5 МБ) напрямую в Supabase Storage
12. Экспорт CSV + кнопка "Скопировать ссылку класса"
13. Все вкладки админки включая Учителя
14. Импорт учеников из CSV (кнопка в вкладке Ученики)
15. Удаление учеников с предупреждением (двойное если уже подтвердил выбор)
16. Протестировано на двух учениках ✓

---

## ЧТО НЕ СДЕЛАНО (по приоритету)

### Перед боевым запуском:
1. Sharp на сервере — лучшее качество сжатия
2. Учителя в экспорт CSV для вёрстки
3. Параметры альбома в UI:
   - group_exclusive (да/нет)
   - group_photo_limit (сейчас жёстко 2)
   - teacher_role_name (учитель/воспитатель/педагог)

### После первого теста:
4. Автодеплой через GitHub
5. Мультиаренда (несколько фотографов)
6. Интеграция с автовёрсткой InDesign

---

## КАК ЗАПУСТИТЬ И ДЕПЛОИТЬ

Локально:
  cd ~/Desktop/yearbook-v2 && npm run dev

Деплой:
  cd ~/Desktop/yearbook-v2 && npm run build && npx vercel --prod

Сброс тестового ученика:
  update children set submitted_at = null where full_name = 'Имя';
  delete from selections where child_id = (select id from children where full_name = 'Имя');
  delete from parent_contacts where child_id = (select id from children where full_name = 'Имя');
  delete from cover_selections where child_id = (select id from children where full_name = 'Имя');
  delete from photo_locks where child_id = (select id from children where full_name = 'Имя');
  delete from student_texts where child_id = (select id from children where full_name = 'Имя');
  delete from drafts where child_id = (select id from children where full_name = 'Имя');

Фото в Storage но не в базе:
  insert into photos (album_id, filename, storage_path, type)
  select 'ALBUM_ID', split_part(name, '/', 3), name, 'portrait'
  from storage.objects
  where bucket_id = 'photos'
  and name like 'ALBUM_ID/portrait/%'
  and name not in (select storage_path from photos);
