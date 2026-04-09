# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов
# Обновлено: 08.04.2026 (финал дня)

---

## КТО Я И ЧТО МЫ ДЕЛАЕМ

Я — фотограф/организатор выпускных альбомов. У меня штат фотографов и я работаю
с внешними фотографами (ретушь + вёрстка + печать). Мы делаем веб-систему для
отбора фотографий родителями вместо текущего неудобного процесса через Google Диск.

---

## ТИП АЛЬБОМА — «УНИВЕРСАЛ»

Структура альбома:
1. Обложка (портрет или общее фото класса или надпись)
2. Раздел учителей (ФИО, должность, портрет)
3. Личные страницы каждого ученика (1 страница на ученика)
4. Общий раздел (выбираем сами, вне системы)

Правила блокировки фото:
- Портреты: общий пул для всего класса. 1 портрет = 1 ребёнок.
  Выбранные видны всем но серые и недоступны.
- Групповые фото: то же самое. 1 фото = 1 ребёнок.
- Планируется вариант где одно фото могут выбрать несколько учеников — на будущее.

---

## СЦЕНАРИЙ — 6 ШАГОВ ДЛЯ РОДИТЕЛЯ

Шаг 1 — Контакты (имя родителя + телефон)
Шаг 2 — Портрет для личной страницы (общий пул, блокировка)
Шаг 3 — Портрет для обложки (cover_mode: none/same/optional/required)
Шаг 4 — Текст от ученика (до 500 символов)
Шаг 5 — 2 фото с друзьями (эксклюзивная блокировка)
Шаг 6 — Подтверждение

Отдельный сценарий: Ответственный родитель → /teacher/[token]
Заполняет ФИО, должность, портрет для каждого учителя.

---

## СТЕК

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS + Unbounded + Geologica
- Supabase (PostgreSQL + Storage)
- Vercel (задеплоено)
- browser-image-compression (сжатие до ~400 КБ)

---

## ССЫЛКИ

- Сайт: https://yearbook-v2.vercel.app
- Админка: https://yearbook-v2.vercel.app/admin
- Supabase URL: https://bnotiyhamfyllcrqwquq.supabase.co
- Supabase проект: yearbook-photos, организация: yearbook

Тестовый альбом: "Тукей", album_id: d57b2207-42f2-4ff1-916c-4e01de1cff7d
Тестовый ученик 1: Иванов Иван, token: 260e785f92242b9317d6e3fff7fba826
Тестовый ученик 2: Петров Петя
Ответственный родитель: token: b149747dcaf8bf42feb8d5d938f0fd77

---

## ВАЖНО: КЛЮЧИ SUPABASE

Legacy ключи (eyJ... формат) — не новые sb_publishable_/sb_secret_
Найти: Supabase → Settings → API Keys → "Legacy anon, service_role API keys"

Storage policy (уже создана):
  create policy "Allow public uploads" on storage.objects for insert
  to anon with check (bucket_id = 'photos');

---

## СТРУКТУРА ПРОЕКТА

Папка: ~/Desktop/yearbook-v2

app/
  [token]/page.tsx                — родитель (6 шагов) ✓
  teacher/[token]/page.tsx        — ответственный родитель (учителя) ✓
  admin/page.tsx                  — админка ✓
  api/
    child/route.ts                ✓
    select/route.ts               ✓
    teacher/route.ts              ✓
    admin/route.ts                ✓
    admin/register-photo/route.ts ✓
    draft/route.ts                ✓

---

## ТАБЛИЦЫ В БД

- albums, children, teachers, responsible_parents
- photos (portrait/group/teacher)
- photo_children, photo_teachers
- selections, parent_contacts, student_texts
- cover_selections, photo_locks
- drafts (автосохранение черновика)

---

## ЧТО ПОЛНОСТЬЮ РАБОТАЕТ ✓

1. Интерфейс родителя — все 6 шагов
2. Блокировка портретов (общий пул, 1=1)
3. Блокировка групповых фото (1=1)
4. Выбор обложки с доплатой
5. Текст от ученика
6. Автосохранение черновика
7. Страница учителей (/teacher/[token])
8. Админка — все вкладки включая Учителя
9. Загрузка фото со сжатием (~400 КБ)
10. Экспорт CSV для вёрстки
11. База контактов родителей (телефоны)
12. Деплой на Vercel

---

## ЧТО ОСТАЛОСЬ СДЕЛАТЬ

### Приоритет 1 — удобство работы:
1. Кнопка "Скопировать все ссылки" — выгрузка всех ссылок учеников
   одним CSV для массовой рассылки через WhatsApp
2. Экспорт учителей в CSV для вёрстки
3. Добавить учителей в общий экспорт для вёрстки

### Приоритет 2 — новые функции:
4. Вариант где одно фото могут выбрать несколько учеников
   (параметр на уровне альбома)
5. Дедлайн — после него ссылки не работают (поле уже есть в БД,
   проверка в API тоже есть, но в UI дедлайн не отображается родителю)

### На будущее:
6. Интеграция с автовёрсткой InDesign
7. Скрипт генерации CSV разметки из папок

---

## КАК ЗАПУСТИТЬ И ДЕПЛОИТЬ

Локально:
  cd ~/Desktop/yearbook-v2 && npm run dev

Деплой:
  cd ~/Desktop/yearbook-v2 && npm run build && npx vercel --prod

Если данные не обновляются:
  cd ~/Desktop/yearbook-v2 && rm -rf .next && npm run dev

---

## ИЗВЕСТНЫЕ ПРОБЛЕМЫ И РЕШЕНИЯ

Фото в Storage но не в базе — SQL:
  insert into photos (album_id, filename, storage_path, type)
  select 'ALBUM_ID',
    split_part(name, '/', 3), name, 'portrait'
  from storage.objects
  where bucket_id = 'photos'
  and name like 'ALBUM_ID/portrait/%'
  and name not in (select storage_path from photos);

storage_path правильный формат: album_id/type/timestamp_filename.jpg
