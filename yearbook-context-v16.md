# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов
# Обновлено: 15.04.2026

---

## КТО Я И ЧТО МЫ ДЕЛАЕМ

Фотограф/организатор выпускных альбомов.
Веб-система для отбора фотографий родителями вместо Google Диска.

---

## СТЕК

- Next.js 14 + TypeScript + Tailwind
- Supabase (PostgreSQL + Storage)
- Vercel: https://yearbook-v2.vercel.app
- Домен: https://album.okeybook.ru (через Cloudflare)
- GitHub: https://github.com/odintcovsergey/yearbook-v2
- Зеркало: https://gitflic.ru/project/odintcovsergey/yearbook-v2

---

## ССЫЛКИ И ДОСТУПЫ

- Сайт: https://album.okeybook.ru (= https://yearbook-v2.vercel.app)
- Админка: https://album.okeybook.ru/admin
- ADMIN_SECRET: хранится в Vercel → Settings → Environment Variables
- GitHub токен: хранится в Vercel env (до Jul 09, 2026)
- Supabase: https://supabase.com/dashboard
- Cloudflare: https://dash.cloudflare.com (okeybook.ru)
- Cron keep-alive: cron-job.org каждые 12ч → /api/admin

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
teachers (description — текст от кл. руководителя, только первый)
responsible_parents
photos (portrait/group/teacher, thumb_path)
photo_children, photo_teachers
selections, parent_contacts
student_texts
cover_selections, photo_locks, drafts
album_templates (+ text_type, template_title)
quotes (id, text, category, created_at)
quote_selections (quote_id, child_id, album_id, UNIQUE quote+album)
referral_leads (id, referrer_child_id, name, phone, city, school, class_name, status, created_at)

---

## ТИПЫ ТЕКСТА (text_type в albums)

- free — свободное поле (по умолчанию)
- garden — Детский сад: вопросы + пример
- grade4 — 4 класс: вопросы + пример
- grade11 — 9-11 класс: свободное поле + список цитат на выбор (блокировка)

---

## РЕЖИМЫ ОБЛОЖКИ (cover_mode)

- required — Обязателен (все платят): родитель сразу выбирает второй портрет
- optional — На выбор: 3 варианта (без портрета / тот же / другой с доплатой)
- none, same — legacy, обратная совместимость сохранена

---

## ЧТО РАБОТАЕТ

### Главная страница админки
- Карточки с прогресс-баром, крупным %
- Вкладки «Актуальные / Архив» для архивных заказов
- Кнопки: Шаблоны, Цитаты, Заявки (с бейджем новых), + Новый альбом
- Шестерёнка на карточке → модалка редактирования настроек альбома
- Поиск, фильтры по статусу, сортировка

### Редактирование альбома (модалка)
- Название, город, год, дедлайн
- Обложка (Обязателен / На выбор + доплата)
- Групповые фото (вкл/выкл, мин/макс, эксклюзив)
- Текст от ученика (вкл/выкл, макс символов, тип)

### Создание альбома
- Выбор шаблона → применяет все параметры
- 2 режима обложки: Обязателен / На выбор

### Вкладки внутри альбома
- Обзор: дедлайн, экспорт CSV (без URL-ссылок), напоминание, архивирование
- Ученики: чекбоксы, массовые действия, панель деталей
- Фото: параллельная загрузка, WebP, сортировка по filename
- Учителя: токен в карточке

### Сценарий родителя
- Шаг 1: портрет, sticky подсказка, миниатюра выбранного в sticky-панели
- Шаг 2: обложка (required = сразу выбор / optional = 3 варианта)
- Шаг 3: фото с друзьями, миниатюры выбранных в sticky-панели
- Шаг 4: текст, кнопки Назад/Далее над списком цитат
- Шаг 5: телефон + согласие на обработку ПД (текст под кнопкой)
- Шаг 6: подтверждение
- Нумерация страниц (1,2,3...) вместо стрелок, скролл к сетке
- После подтверждения: «Спасибо» + реферальная ссылка
- Повторный заход: «Выбор уже сделан» + реферальная ссылка

### Учителя (/teacher/[token])
- Поле «Текст от классного руководителя» у первого учителя
- Инструкция про пожелание в описании

### Реферальная система
- /ref/[token] — лендинг с формой (имя, телефон, город, школа, класс)
- Согласие на обработку ПД
- Заявки в админке (Новая → В работе → Заказ → Отказ)
- Бейдж-счётчик новых на кнопке «Заявки»
- Имя реферера + название альбома в карточке заявки

### Политика конфиденциальности
- /privacy — ИП Одинцов С.Н., ИНН 183310659096
- Текст согласия под кнопками на шаге 5 и реферальной форме

### API endpoints
- /api/child — text_type, quotes, takenQuoteIds, selectedQuoteId
- /api/quote — сохранение/снятие выбора цитаты
- /api/referral — GET info + POST заявка
- /api/admin — CRUD для всего + get_leads, update_lead_status, delete_lead, update_album

---

## ЧТО ЗАПЛАНИРОВАНО

- Интеграция с Битрикс24 (лиды из реферальной системы)
- Миграция на российские сервисы (Timeweb/Yandex Cloud)
- Мультиаренда — отдельные логины для сотрудников
- Демо-ссылка для клиентов

---

## ЛИМИТЫ СЕРВИСОВ

Supabase Free: Storage ~0.25/1GB, Database 0.028/0.5GB, Egress 5GB
Cron-job.org: keep-alive каждые 12ч (защита от заморозки)
Cloudflare Free: DNS + прокси (обход блокировок РФ)

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
