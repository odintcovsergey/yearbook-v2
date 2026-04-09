# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов
# Обновлено: 09.04.2026

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

## СЦЕНАРИЙ РОДИТЕЛЯ (5 шагов + подтверждение)

Шаг 1 — Портрет (общий пул, блокировка)
Шаг 2 — Обложка (cover_mode: none/same/optional/required, доплата)
Шаг 3 — Текст (до 500 символов)
Шаг 4 — 2 фото с друзьями (блокировка)
Шаг 5 — Телефон + имя родителя
Шаг 6 — Подтверждение

ВХОД: Одна ссылка на класс /album/[albumId] → список учеников → выбор своего
После выбора ребёнка → переход на /[token] (персональный токен)

Ответственный родитель → /teacher/[token] → ФИО и должность учителей

---

## СТЕК

- Next.js 14 + TypeScript + Tailwind
- Supabase (PostgreSQL + Storage)
- Vercel (задеплоено)
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

Storage policy (уже есть):
  create policy "Allow public uploads" on storage.objects for insert
  to anon with check (bucket_id = 'photos');

---

## СТРУКТУРА ПРОЕКТА

~/Desktop/yearbook-v2/

app/
  album/[albumId]/page.tsx        — список учеников класса ✓
  [token]/page.tsx                — интерфейс родителя (6 шагов) ✓
  teacher/[token]/page.tsx        — страница учителей ✓
  admin/page.tsx                  — админка ✓
  api/
    album/route.ts                — список учеников для общей ссылки ✓
    child/route.ts                — данные по токену ✓
    select/route.ts               — блокировка + сохранение ✓
    teacher/route.ts              — учителя ✓
    admin/route.ts                — весь API администратора ✓
    admin/register-photo/route.ts — регистрация фото после загрузки ✓
    draft/route.ts                — автосохранение черновика ✓

---

## ТАБЛИЦЫ БД

albums, children, teachers, responsible_parents
photos (portrait/group/teacher)
photo_children, photo_teachers
selections, parent_contacts, student_texts
cover_selections, photo_locks, drafts

---

## ЧТО РАБОТАЕТ ✓

1. Общая ссылка на класс → список учеников → выбор своего
2. Лайтбокс с навигацией (стрелки, свайп, миниатюры внизу)
3. Выбор фото через + на миниатюре И через кнопку в лайтбоксе
4. Мгновенный отклик (will-change: transform, оптимистичное обновление)
5. Блокировки портретов и групповых фото
6. Автосохранение черновика
7. Страница учителей
8. Загрузка фото со сжатием (1.5 МБ, 2048px)
9. Телефон на шаге 5 с правильной формулировкой
10. Экспорт CSV для вёрстки
11. Доплаты за обложку
12. Все вкладки админки включая Учителя

---

## ЧТО НЕ СДЕЛАНО

### Приоритет 1:
1. Кнопка "Скопировать все ссылки" — одна ссылка на класс уже есть
   но нужна выгрузка персональных ссылок CSV для тех кто хочет
2. Учителя в экспорт CSV для вёрстки
3. Провести первый реальный тест на классе

### Приоритет 2:
4. Параметры альбома в UI:
   - group_exclusive (да/нет — можно ли нескольким)
   - group_photo_limit (сколько выбирать, сейчас жёстко 2)
   - teacher_role_name (учитель/воспитатель/педагог)
5. Автодеплой через GitHub

### На будущее:
6. Sharp на сервере для лучшего качества сжатия
7. Мультиаренда (несколько фотографов в одной системе)
8. Интеграция с автовёрсткой InDesign

---

## КАК ЗАПУСТИТЬ И ДЕПЛОИТЬ

Локально:
  cd ~/Desktop/yearbook-v2 && npm run dev

Деплой:
  cd ~/Desktop/yearbook-v2 && npm run build && npx vercel --prod

Если данные не обновляются:
  cd ~/Desktop/yearbook-v2 && rm -rf .next && npm run dev

---

## ИЗВЕСТНЫЕ РЕШЕНИЯ

Фото в Storage но не в базе:
  insert into photos (album_id, filename, storage_path, type)
  select 'ALBUM_ID', split_part(name, '/', 3), name, 'portrait'
  from storage.objects
  where bucket_id = 'photos'
  and name like 'ALBUM_ID/portrait/%'
  and name not in (select storage_path from photos);

Сбросить тестового ученика:
  update children set submitted_at = null where full_name = 'Имя';
  delete from selections where child_id = (select id from children where full_name = 'Имя');
  delete from parent_contacts where child_id = (select id from children where full_name = 'Имя');
  delete from cover_selections where child_id = (select id from children where full_name = 'Имя');
  delete from photo_locks where child_id = (select id from children where full_name = 'Имя');
  delete from student_texts where child_id = (select id from children where full_name = 'Имя');
  delete from drafts where child_id = (select id from children where full_name = 'Имя');

Тормозит интерфейс — добавить на контейнер фото:
  style={{willChange: 'transform'}}
