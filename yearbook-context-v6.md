# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов
# Обновлено: 09.04.2026 (финал)

---

## КТО Я И ЧТО МЫ ДЕЛАЕМ

Я — фотограф/организатор выпускных альбомов. Штат фотографов + внешние фотографы
(ретушь + вёрстка + печать). Веб-система для отбора фотографий родителями.

---

## ТИП АЛЬБОМА — «УНИВЕРСАЛ»

Структура: Обложка → Учителя → Личные страницы → Общий раздел (вне системы)

Правила фото:
- Портреты: общий пул класса, 1 портрет = 1 ребёнок, серые у других
- Групповые: то же, 1 фото = 1 ребёнок
- Планируется вариант где одно фото → несколько учеников

---

## СЦЕНАРИЙ РОДИТЕЛЯ (6 шагов)

Шаг 1 — Портрет (общий пул, блокировка, лайтбокс с навигацией)
Шаг 2 — Обложка (cover_mode: none/same/optional/required, доплата)
Шаг 3 — Текст (до 500 символов)
Шаг 4 — 2 фото с друзьями (блокировка)
Шаг 5 — Телефон + имя ("Сообщим когда альбом будет готов")
Шаг 6 — Подтверждение (с кнопкой ← Изменить)

ВХОД: Одна ссылка на класс /album/[albumId] → список учеников → выбор своего
После выбора → /[token] (персональный токен ученика)

Ответственный родитель → /teacher/[token]

Страница ошибки — есть кнопки "Вернуться назад" и "Попробовать снова"
Автосохранение — портрет, групповые, текст, обложка, шаг восстанавливаются

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
Иванов Иван token: 260e785f92242b9317d6e3fff7fba826
Ответственный token: b149747dcaf8bf42feb8d5d938f0fd77

ВАЖНО: Legacy ключи Supabase (eyJ... формат)
Найти: Settings → API Keys → "Legacy anon, service_role API keys"

Storage policy (уже создана):
  create policy "Allow public uploads" on storage.objects
  for insert to anon with check (bucket_id = 'photos');

---

## СТРУКТУРА ПРОЕКТА

~/Desktop/yearbook-v2/

app/
  album/[albumId]/page.tsx        — список учеников класса ✓
  [token]/page.tsx                — интерфейс родителя (6 шагов) ✓
  teacher/[token]/page.tsx        — страница учителей ✓
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

## ТАБЛИЦЫ БД

albums, children, teachers, responsible_parents
photos (portrait/group/teacher)
photo_children, photo_teachers
selections, parent_contacts, student_texts
cover_selections, photo_locks, drafts

---

## ЧТО ПОЛНОСТЬЮ РАБОТАЕТ ✓

1. Общая ссылка на класс → список → выбор ребёнка
2. Лайтбокс: стрелки, свайп, миниатюры, кнопка выбрать внутри
3. Выбор через + на миниатюре И через лайтбокс
4. Мгновенный отклик (will-change: transform, setTimeout для lockPhoto)
5. Блокировки портретов и групповых (оптимистичное обновление)
6. Автосохранение черновика (портрет, групповые, текст, обложка, шаг)
7. Страница ошибки с кнопками назад/повтор
8. Страница учителей (/teacher/[token])
9. Загрузка фото со сжатием (1.5 МБ, 2048px)
10. Телефон на шаге 5 с правильной формулировкой
11. Экспорт CSV для вёрстки
12. Доплаты за обложку
13. Вкладка Учителя в админке (добавить учителя, ссылка ответственному)
14. Полный сценарий протестирован на двух учениках ✓

---

## ЧТО НЕ СДЕЛАНО (по приоритету)

### Перед боевым запуском:
1. Качество сжатия — рассмотреть Sharp на сервере (текущий browser-image-compression
   даёт заметно худшее качество чем профессиональные инструменты)
2. Учителя в экспорт CSV для вёрстки (сейчас только ученики)
3. Параметры альбома в UI:
   - group_exclusive (да/нет)
   - group_photo_limit (сейчас жёстко 2)
   - teacher_role_name (учитель/воспитатель/педагог)

### После первого теста:
4. Автодеплой через GitHub (чтобы не запускать терминал)
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
