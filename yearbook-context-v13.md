# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов
# Обновлено: 12.04.2026

---

## КТО Я И ЧТО МЫ ДЕЛАЕМ

Фотограф/организатор выпускных альбомов. Штат фотографов + внешние фотографы.
Веб-система для отбора фотографий родителями вместо Google Диска.

---

## ТИП АЛЬБОМА — «УНИВЕРСАЛ»

Структура: Обложка → Учителя → Личные страницы → Общий раздел (вне системы)

Правила фото:
- Портреты: общий пул класса, 1 портрет = 1 ребёнок, серые у других
- Групповые (2-5): блокировка если group_exclusive=true
- Учителя: ответственный родитель выбирает фото и вводит ФИО/должность

---

## СЦЕНАРИЙ РОДИТЕЛЯ (6 шагов)

Шаг 1 (id=1) — Портрет (пагинация 40 фото, клик = выбор, sticky подсказка)
Шаг 2 (id=2) — Обложка (cover_mode: none/same/optional/required)
Шаг 3 (id=4) — Фото с друзьями — ПЕРЕД текстом
Шаг 4 (id=3) — Текст (до N символов)
Шаг 5 (id=5) — Телефон + имя + реферал (скидка 50% за рекомендацию)
Шаг 6 (id=6) — Подтверждение с превьюшками фото

ВАЖНО: порядок шагов в STEPS массиве: [1, 2, 4, 3, 5, 6]

ВХОД: /album/[albumId] → список учеников → выбор → /[token]
Ответственный: /teacher/[token]

После подтверждения: повторный заход по ссылке показывает экран
«Выбор уже сделан — обратитесь к менеджеру» без доступа к шагам.

---

## СЦЕНАРИЙ УЧИТЕЛЕЙ

1. Админ загружает фото учителей через вкладку Фото → тип "Учителя"
2. Ответственный открывает /teacher/[token]
3. Кликает на фото → вводит ФИО и должность → Сохранить карточку
4. Нажимает "Сохранить всё и завершить"

---

## СТЕК

- Next.js 14 + TypeScript + Tailwind
- Supabase (PostgreSQL + Storage)
- Vercel: https://yearbook-v2.vercel.app
- GitHub: https://github.com/odintcovsergey/yearbook-v2
- browser-image-compression (WebP, maxSizeMB: 1.2, maxWidthOrHeight: 2048)

---

## ССЫЛКИ И ДОСТУПЫ

- Сайт: https://yearbook-v2.vercel.app
- Админка: https://yearbook-v2.vercel.app/admin
- ADMIN_SECRET: хранится в Vercel → Settings → Environment Variables
- GitHub токен: хранится в Vercel env (действует до Jul 09, 2026)
- Supabase: https://supabase.com/dashboard

Клонирование в новом сеансе Claude:
  git clone https://odintcovsergey:[ТОКЕН]@github.com/odintcovsergey/yearbook-v2.git ~/yearbook-v2
  cd ~/yearbook-v2
  git config user.email "deploy@yearbook.app"
  git config user.name "Deploy Bot"
  git remote set-url origin https://odintcovsergey:[ТОКЕН]@github.com/odintcovsergey/yearbook-v2.git

Деплой — автоматический через GitHub. Push в main = деплой через 1-2 минуты.

---

## ТАБЛИЦЫ БД

albums (archived boolean, group_enabled, group_min, group_max, group_exclusive,
        text_enabled, text_max_chars, city, year, cover_mode, cover_price, deadline)
children (started_at, submitted_at)
teachers, responsible_parents
photos (portrait/group/teacher, thumb_path)
photo_children, photo_teachers
selections, parent_contacts (referral), student_texts
cover_selections, photo_locks, drafts
album_templates

Миграции (уже применены):
  ALTER TABLE albums ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;
  ALTER TABLE photos ADD COLUMN IF NOT EXISTS thumb_path text;

---

## СТРУКТУРА ПРОЕКТА

app/
  album/[albumId]/page.tsx        — список учеников
  [token]/page.tsx                — интерфейс родителя
  teacher/[token]/page.tsx        — учителя
  admin/page.tsx                  — админка
  api/
    album/route.ts
    child/route.ts                (возвращает thumb_path)
    select/route.ts               (валидация существования фото)
    teacher/route.ts
    admin/route.ts                (child_details, fix_broken_selections и др.)
    admin/register-photo/route.ts
    admin/upload-photo/route.ts   (Sharp — не используется из-за лимита Vercel 4.5MB)
    draft/route.ts                (очищает удалённые фото из черновика)

---

## ЧТО РАБОТАЕТ

### Главная страница админки
- Прогресс-бар, дедлайн, статус, поиск, фильтр, сортировка
- Кнопки в карточке: ✏️ переименовать, Класс, Учителя, Удалить
- Статус учителей в карточке: ✓ заполнены / ⚠ не заполнены / частично
- Удаление альбома удаляет файлы из Storage
- Кнопка 📐 Шаблоны рядом с + Новый альбом (модальное окно)
- Статистика обновляется при возврате на главную

### Вкладки внутри альбома
- Обзор: дедлайн, экспорт CSV, напоминание, архивирование
- Ученики:
  - Импорт CSV (full_name,class), поиск
  - Чекбоксы для массового выбора + кнопки Сбросить/Удалить выбранных
  - Дата подтверждения в таблице
  - Панель деталей справа (клик по строке) — превьюшки фото, текст, контакт
  - Кнопки Сбросить/Удалить/Копировать не открывают панель деталей
- Фото: параллельная загрузка всех типов (5 файлов одновременно), WebP конвертация
  При удалении фото удаляется и thumb из Storage
- CSV экспорт: Фото_друзья_1..10, блок УЧИТЕЛЬ в конце
- Учителя: токен в карточке альбома на главной

### Сценарий родителя
- Пагинация: 40 фото на страницу
- Клик по фото = выбор (плюсик убран)
- Кнопка «Далее» sticky на шагах 1, 2, 4
- Sticky подсказка: синяя → жёлтая → зелёная
- Spinner на кнопке «Подтвердить» во время сохранения
- После подтверждения повторный заход = экран «Выбор уже сделан»
- Ошибки сабмита показываются inline

### Учителя (/teacher/[token])
- Клик по фото = выбор
- Фото другого учителя заблокировано (замок)

### Архивирование
- Удаляет все фото из Storage батчами по 100
- albums.archived = true

### Напоминание незавершившим
- Модал с готовым текстом: ФИО + личная ссылка каждого

---

## CSV ЭКСПОРТ (для верстальщика)

Колонки: Класс, Ученик, Портрет_страница, URL_портрет_страница,
Обложка, Портрет_обложка, URL_портрет_обложка, Текст,
Фото_друзья_1..10, URL_фото_1..10

В конце — блок УЧИТЕЛЬ (ФИО, должность в колонке Обложка, фото)

---

## ИНСТРУМЕНТ СОРТИРОВКИ ФОТО (sort_photos.py)

GUI на Python/tkinter. Два поля:
1. Папка с исходниками (содержит: Портреты/, 2-5/, Учителя/)
2. CSV файл экспорта

Результат в папке «Готово»:
- [ФИО ученика]/ → [Фамилия Имя].jpg, Обложка.jpg, Фото_1.jpg...
- УЧИТЕЛЯ/ → [ФИО - должность].jpg

Сборка .exe на Windows:
  pip install pyinstaller
  pyinstaller --onefile --windowed --name "Раскладка фото" sort_photos.py

---

## ЛИМИТЫ СЕРВИСОВ

Vercel (Free): 100GB трафик, 100ч serverless/мес → платный $20/мес
Supabase (Free): Storage 1GB (сейчас 22%), Database 0.5GB (6%), Egress 5GB/мес
Supabase (Pro): $25/мес → 8GB Storage, 50GB Egress, Image Transformations
Image Transformations на Free плане недоступны → миниатюры через ?width=400
Sharp на сервере не работает из-за лимита Vercel 4.5MB на запрос

Решение для Storage: кнопка «Архивировать» после сдачи в вёрстку.

---

## ЧТО ЗАПЛАНИРОВАНО (следующие задачи)

### Реферальная система (приоритет — высокий)
- Страница /ref/[token] — лендинг с формой контактов
- Таблица referral_leads (кто пришёл, от кого, контакты)
- Блок на экране «Спасибо» с кнопкой «Скопировать мою ссылку»
- Вкладка в админке — список лидов
- Вопросы для уточнения: что показывать на лендинге, условия скидки

### Остальное
- Мультиаренда — отдельные логины для сотрудников
- История изменений — кто сбросил/удалил и когда
- Cloudflare R2 — когда Supabase Storage станет мало
- Демо-ссылка для потенциальных клиентов

---

## КАК ЗАПУСТИТЬ ЛОКАЛЬНО

cd ~/Desktop/yearbook-v2 && npm run dev

## СБРОС ТЕСТОВОГО УЧЕНИКА (SQL в Supabase)

update children set submitted_at = null, started_at = null where full_name = 'Имя';
delete from drafts where child_id = (select id from children where full_name = 'Имя');
delete from selections where child_id = (select id from children where full_name = 'Имя');
delete from parent_contacts where child_id = (select id from children where full_name = 'Имя');
delete from cover_selections where child_id = (select id from children where full_name = 'Имя');
delete from photo_locks where child_id = (select id from children where full_name = 'Имя');
delete from student_texts where child_id = (select id from children where full_name = 'Имя');
