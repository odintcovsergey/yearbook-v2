# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов
# Обновлено: 11.04.2026 (финал дня)

---

## КТО Я И ЧТО МЫ ДЕЛАЕМ

Фотограф/организатор выпускных альбомов. Штат фотографов + внешние фотографы.
Веб-система для отбора фотографий родителями вместо Google Диска.

---

## ТИП АЛЬБОМА — «УНИВЕРСАЛ»

Структура: Обложка → Учителя → Личные страницы → Общий раздел (вне системы)

Правила фото:
- Портреты: общий пул класса, 1 портрет = 1 ребёнок, серые у других
- Групповые (2-5): то же, блокировка если group_exclusive=true
- Учителя: ответственный родитель выбирает фото и вводит ФИО/должность

---

## СЦЕНАРИЙ РОДИТЕЛЯ (6 шагов)

Шаг 1 (id=1) — Портрет (общий пул, блокировка, пагинация 40 фото, клик = выбор)
Шаг 2 (id=2) — Обложка (cover_mode: none/same/optional/required, доплата)
Шаг 3 (id=4) — Фото с друзьями — ПЕРЕД текстом
Шаг 4 (id=3) — Текст (до 500 символов)
Шаг 5 (id=5) — Телефон + имя + реферал
Шаг 6 (id=6) — Подтверждение с превьюшками фото

ВАЖНО: порядок шагов в STEPS массиве: [1, 2, 4, 3, 5, 6]

ВХОД: /album/[albumId] → список учеников → выбор → /[token]
Ответственный: /teacher/[token]

---

## СТЕК

- Next.js 14 + TypeScript + Tailwind
- Supabase (PostgreSQL + Storage)
- Vercel: https://yearbook-v2.vercel.app
- GitHub: https://github.com/odintcovsergey/yearbook-v2
- browser-image-compression (maxSizeMB: 1.5, maxWidthOrHeight: 2048)

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

albums (+ archived boolean DEFAULT false)
children (+ started_at, submitted_at)
teachers, responsible_parents
photos (portrait/group/teacher)
photo_children, photo_teachers
selections, parent_contacts, student_texts
cover_selections, photo_locks, drafts
album_templates

---

## СТРУКТУРА ПРОЕКТА

app/
  album/[albumId]/page.tsx        — список учеников
  [token]/page.tsx                — интерфейс родителя
  teacher/[token]/page.tsx        — учителя
  admin/page.tsx                  — админка
  api/
    album/route.ts
    child/route.ts
    select/route.ts
    teacher/route.ts              (actions: create/save/delete/submit)
    admin/route.ts
    admin/register-photo/route.ts
    draft/route.ts

---

## ЧТО РАБОТАЕТ

### Главная страница админки
- Прогресс-бар, дедлайн, статус для каждого альбома
- Поиск, фильтр по статусу, сортировка
- Кнопки в карточке: ✏️ переименовать, Класс, Учителя, Удалить
- Удаление альбома удаляет все файлы из Storage
- Статистика обновляется при возврате на главную

### Вкладки внутри альбома
- Обзор: дедлайн, экспорт CSV, ссылка класса, напоминание незавершившим, архивирование
- Ученики: импорт CSV (full_name,class), поиск, Сбросить/Удалить
- Фото: параллельная загрузка всех типов (5 файлов одновременно), галерея с удалением
- CSV экспорт: без Родитель/Телефон/Доплата, Фото_друзья_1..10, блок УЧИТЕЛЬ в конце
- Учителя: ответственный создаётся автоматически

### Сценарий родителя
- Пагинация: 40 фото на страницу
- Клик по фото = выбор (плюсик убран)
- Кнопка «Далее» sticky на шагах 1, 2, 4
- Горизонтальный скролл миниатюр в лайтбоксе
- Sticky подсказка: синяя → жёлтая → зелёная
- При лимите 1 — клик заменяет выбор
- Итоговый экран: превьюшки фото с кликом только на выбранное
- Черновик очищается от удалённых фото при загрузке
- Ошибки сабмита показываются inline, возвращают на нужный шаг

### Учителя (/teacher/[token])
- Клик по фото = выбор (плюсик убран)
- Фото другого учителя заблокировано (замок)
- В лайтбоксе заблокированное фото = плашка вместо кнопки

### Архивирование
- Кнопка в Обзоре: удаляет все фото из Storage батчами по 100
- Данные (выборы, тексты, контакты) остаются в базе
- Поле albums.archived = true

### Напоминание незавершившим
- Кнопка в Обзоре (видна только если есть незавершившие)
- Открывает модал с готовым текстом: ФИО + личная ссылка каждого
- Кнопка «Скопировать текст» → вставить в чат

---

## CSV ЭКСПОРТ (для верстальщика)

Колонки: Класс, Ученик, Портрет_страница, URL_портрет_страница,
Обложка, Портрет_обложка, URL_портрет_обложка, Текст,
Фото_друзья_1..10, URL_фото_1..10

В конце — пустая строка и блок УЧИТЕЛЬ:
- Класс = "УЧИТЕЛЬ"
- Ученик = ФИО
- Обложка = должность
- Портрет_страница = имя файла
- URL_портрет_страница = ссылка

---

## ИНСТРУМЕНТ СОРТИРОВКИ ФОТО (sort_photos.py)

GUI на Python/tkinter. Два поля:
1. Папка с исходниками (содержит: Портреты/, 2-5/, Учителя/)
2. CSV файл экспорта

Результат в папке «Готово» внутри папки с исходниками:
- [ФИО ученика]/ → [Фамилия Имя].jpg, Обложка.jpg, Фото_1.jpg...
- УЧИТЕЛЯ/ → [ФИО - должность].jpg

Сборка .exe на Windows:
  pip install pyinstaller
  pyinstaller --onefile --windowed --name "Раскладка фото" sort_photos.py
  Готовый файл: dist/Раскладка фото.exe

---

## ЛИМИТЫ СЕРВИСОВ

Vercel (Free): 100GB трафика/мес, 100ч serverless/мес → платный $20/мес
Supabase (Free): 500MB БД, 1GB Storage (~3 альбома) → платный $25/мес → 8GB
GitHub — бесплатно

Решение для Storage: кнопка «Архивировать» удаляет фото после сдачи в вёрстку.
Долгосрочно: Cloudflare R2 (10GB бесплатно, потом $0.015/GB).

---

## ЧТО ЕЩЁ НЕ СДЕЛАНО

1. Sharp на сервере — лучшее качество сжатия
2. Мультиаренда — несколько фотографов с отдельными логинами
3. История изменений — кто и когда сбросил/удалил
4. Предпросмотр страницы альбома для родителя
5. Cloudflare R2 вместо Supabase Storage

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

## МИГРАЦИИ БД (уже применены)

ALTER TABLE albums ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;
