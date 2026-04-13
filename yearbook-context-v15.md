# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов
# Обновлено: 13.04.2026

---

## КТО Я И ЧТО МЫ ДЕЛАЕМ

Фотограф/организатор выпускных альбомов.
Веб-система для отбора фотографий родителями вместо Google Диска.

---

## СТЕК

- Next.js 14 + TypeScript + Tailwind
- Supabase (PostgreSQL + Storage)
- Vercel: https://yearbook-v2.vercel.app
- GitHub: https://github.com/odintcovsergey/yearbook-v2

---

## ССЫЛКИ И ДОСТУПЫ

- Сайт: https://yearbook-v2.vercel.app
- Админка: https://yearbook-v2.vercel.app/admin
- ADMIN_SECRET: хранится в Vercel → Settings → Environment Variables
- GitHub токен: хранится в Vercel env (до Jul 09, 2026)
- Supabase: https://supabase.com/dashboard

Клонирование в новом сеансе Claude:
  git clone https://odintcovsergey:[ТОКЕН]@github.com/odintcovsergey/yearbook-v2.git ~/yearbook-v2
  cd ~/yearbook-v2
  git config user.email "deploy@yearbook.app"
  git config user.name "Deploy Bot"
  git remote set-url origin https://odintcovsergey:[ТОКЕН]@github.com/odintcovsergey/yearbook-v2.git

Деплой — автоматический. Push в main = деплой через 1-2 минуты.

---

## ТАБЛИЦЫ БД

albums (archived, group_enabled, group_min, group_max, group_exclusive,
        text_enabled, text_max_chars, text_type, template_title,
        city, year, cover_mode, cover_price, deadline)
children (started_at, submitted_at)
teachers, responsible_parents
photos (portrait/group/teacher, thumb_path)
photo_children, photo_teachers
selections, parent_contacts (referral), student_texts
cover_selections, photo_locks, drafts
album_templates (+ text_type, template_title)
quotes (id, text, category, created_at) — цитаты для 9-11 классов
quote_selections (quote_id, child_id, album_id, UNIQUE quote+album)

Миграции (применены):
  ALTER TABLE albums ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;
  ALTER TABLE photos ADD COLUMN IF NOT EXISTS thumb_path text;
  ALTER TABLE albums ADD COLUMN IF NOT EXISTS text_type text DEFAULT 'free';
  ALTER TABLE album_templates ADD COLUMN IF NOT EXISTS text_type text DEFAULT 'free';
  ALTER TABLE albums ADD COLUMN IF NOT EXISTS template_title text DEFAULT null;
  CREATE TABLE quotes (...);
  CREATE TABLE quote_selections (...);
  -- RLS для quotes и quote_selections:
  ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Allow public read quotes" ON quotes FOR SELECT USING (true);
  ALTER TABLE quote_selections ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Allow public read quote_selections" ON quote_selections FOR SELECT USING (true);
  CREATE POLICY "Allow public insert quote_selections" ON quote_selections FOR INSERT WITH CHECK (true);
  CREATE POLICY "Allow public delete quote_selections" ON quote_selections FOR DELETE USING (true);

---

## ТИПЫ ТЕКСТА (text_type в albums)

- free — свободное поле (по умолчанию)
- garden — Детский сад: вопросы + пример (трассы, борщ, мечта)
- grade4 — 4 класс: вопросы + пример (суперспособность, пожелания)
- grade11 — 9-11 класс: свободное поле + список цитат на выбор (блокировка)

Цитаты управляются через кнопку «Цитаты» на главной странице админки.
Выбранная цитата блокируется для других учеников того же альбома.
При сбросе/удалении ученика — quote_selections тоже удаляется.

---

## ЧТО РАБОТАЕТ

### Главная страница админки
- Редизайн: вариант А «чистый минимализм»
- Карточки с иконкой-кружком, прогресс-баром, крупным %
- Статус учителей в карточке
- Название шаблона показывается бейджем если использовался
- Кнопки: Шаблоны, Цитаты, + Новый альбом

### Создание альбома
- Выбор шаблона → применяет все параметры включая text_type
- Тип текста: Свободный / Детский сад / 4 класс / 9-11 класс
- template_title сохраняется в альбоме

### Вкладки внутри альбома (редизайн: табы-подчёркивания)
- Обзор: дедлайн, экспорт CSV, напоминание, архивирование
- Ученики: чекбоксы, массовые действия, панель деталей справа, дата подтверждения
- Фото: параллельная загрузка всех типов, WebP, сортировка по filename
- Учителя: токен в карточке на главной

### Сценарий родителя
- Шаг 1: портрет, sticky подсказка, правильный плейсхолдер
- Шаг 2: обложка, выбранный портрет показывается заблокированным
- Шаг 3: фото с друзьями, сортировка по filename
- Шаг 4: текст с подсказками по типу альбома
- Шаг 5: телефон
- Шаг 6: подтверждение
- После подтверждения: экран «Выбор уже сделан»
- Прокрутка вверх при переходе между шагами

### Учителя (/teacher/[token])
- Заблокированное фото в лайтбоксе = плашка вместо кнопки

### API endpoints
- /api/child — возвращает text_type, quotes, takenQuoteIds, selectedQuoteId
- /api/quote — сохранение/снятие выбора цитаты
- /api/admin — CRUD для quotes (get_quotes, create_quote, delete_quote)

---

## ЧТО ЗАПЛАНИРОВАНО

### Реферальная система (следующий приоритет)
- Страница /ref/[token] — лендинг с формой контактов
- Таблица referral_leads
- Блок на экране «Спасибо» с кнопкой «Скопировать мою ссылку»
- Вкладка в админке — список лидов

### Остальное
- Мультиаренда — отдельные логины для сотрудников
- История изменений
- Cloudflare R2 — когда Supabase Storage станет мало
- Демо-ссылка для клиентов

---

## ЛИМИТЫ СЕРВИСОВ

Supabase Free: Storage 0.222/1GB (22%), Database 0.028/0.5GB, Egress 1/5GB
Платный Supabase Pro: $25/мес → 8GB Storage, 50GB Egress, Image Transformations

---

## СБРОС ТЕСТОВОГО УЧЕНИКА (SQL)

update children set submitted_at = null, started_at = null where full_name = 'Имя';
delete from drafts where child_id = (select id from children where full_name = 'Имя');
delete from selections where child_id = (select id from children where full_name = 'Имя');
delete from parent_contacts where child_id = (select id from children where full_name = 'Имя');
delete from cover_selections where child_id = (select id from children where full_name = 'Имя');
delete from photo_locks where child_id = (select id from children where full_name = 'Имя');
delete from student_texts where child_id = (select id from children where full_name = 'Имя');
delete from quote_selections where child_id = (select id from children where full_name = 'Имя');
