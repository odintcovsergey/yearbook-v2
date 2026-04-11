# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов
# Обновлено: 11.04.2026

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

Шаг 1 (id=1) — Портрет (общий пул, блокировка, лайтбокс)
Шаг 2 (id=2) — Обложка (cover_mode: none/same/optional/required, доплата)
Шаг 3 (id=4) — Фото с друзьями (2 фото, блокировка) — ПЕРЕД текстом
Шаг 4 (id=3) — Текст (до 500 символов)
Шаг 5 (id=5) — Телефон + имя ("Сообщим когда альбом будет готов")
Шаг 6 (id=6) — Подтверждение

ВАЖНО: порядок шагов в STEPS массиве: [1, 2, 4, 3, 5, 6]

ВХОД: /album/[albumId] → список учеников → выбор → /[token]
Ответственный: /teacher/[token]

---

## СЦЕНАРИЙ УЧИТЕЛЕЙ

1. Админ загружает фото учителей через вкладку Фото → тип "Учителя"
2. Ответственный родитель открывает /teacher/[token]
3. Нажимает "+ Добавить учителя" → кликает на фото → вводит ФИО и должность
4. Сохраняет каждую карточку
5. Нажимает "Сохранить всё и завершить"

---

## СТЕК

- Next.js 14 + TypeScript + Tailwind
- Supabase (PostgreSQL + Storage)
- Vercel: https://yearbook-v2.vercel.app
- GitHub: https://github.com/odintcovsergey/yearbook-v2
- browser-image-compression (maxSizeMB: 1.5, maxWidthOrHeight: 2048)

---

## ССЫЛКИ

- Сайт: https://yearbook-v2.vercel.app
- Админка: https://yearbook-v2.vercel.app/admin
- Supabase: https://supabase.com/dashboard (проект yearbook)

Тестовый альбом: "Тест 11В"
Legacy ключи Supabase: Settings → API Keys → "Legacy anon, service_role API keys"
ADMIN_SECRET: [ADMIN_SECRET - см. Vercel env] (хранится в Vercel → Settings → Environment Variables)

GitHub токен (действует до Jul 09, 2026):
[GITHUB_TOKEN - см. Vercel env или у себя]

Клонирование в новом сеансе Claude:
git clone https://odintcovsergey:[ТОКЕН]@github.com/odintcovsergey/yearbook-v2.git ~/yearbook-v2
cd ~/yearbook-v2
git config user.email "deploy@yearbook.app"
git config user.name "Deploy Bot"
git remote set-url origin https://odintcovsergey:[ТОКЕН]@github.com/odintcovsergey/yearbook-v2.git

Деплой — автоматический через GitHub. Push в main = деплой через 1-2 минуты.

Storage policy (уже создана):
  create policy "Allow public uploads" on storage.objects
  for insert to anon with check (bucket_id = 'photos');

---

## ТАБЛИЦЫ БД

albums, children (+ started_at поле), teachers, responsible_parents
photos (portrait/group/teacher)
photo_children, photo_teachers
selections, parent_contacts, student_texts
cover_selections, photo_locks, drafts

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
    teacher/route.ts              ✓ (actions: create/save/delete/submit)
    admin/route.ts                ✓
    admin/register-photo/route.ts ✓
    draft/route.ts                ✓ (записывает started_at)

---

## ЧТО РАБОТАЕТ ✓

### Инфраструктура
1. Репо на GitHub с автодеплоем через Vercel (push в main = деплой)
2. GitHub токен настроен в окружении Claude для прямых пушей

### Главная страница админки (список альбомов)
3. Прогресс-бар, дедлайн, статус для каждого альбома
4. Поиск, фильтр по статусу, сортировка
5. Кнопки прямо в карточке: ✏️ переименовать, Класс (копировать ссылку), Учителя (копировать ссылку), Удалить
6. Удаление альбома с двойным подтверждением — удаляет всё включая файлы из Storage
7. Статистика обновляется при возврате на главную

### Вкладки внутри альбома
8. Обзор: редактирование дедлайна, экспорт CSV, копировать ссылку класса
9. Ученики: добавление вручную и импорт CSV (full_name,class), поиск, кнопки Сбросить/Удалить
10. Фото: галерея загруженных фото с счётчиком и удалением (удаление сбрасывает submitted_at у затронутых детей)
11. CSV экспорт: без Родитель/Телефон/Доплата, динамические колонки Фото_друзья_1..10, блок учителей в конце
12. Контакты: столбец Рекомендации
13. Учителя: ответственный создаётся автоматически

### Сценарий родителя
14. Пагинация фото: 40 штук на страницу
15. Клик по миниатюре = выбор (плюсик убран)
16. Кнопка «Далее» фиксирована внизу экрана на шагах 1, 2, 4
17. Горизонтальный скролл миниатюр в лайтбоксе
18. Sticky подсказка меняет цвет: синяя → жёлтая → зелёная
19. При лимите 1 — клик заменяет выбор без блокировки
20. Итоговый экран: превьюшки фото вместо имён файлов, клик открывает только это фото
21. При удалении фото: submitted_at сбрасывается у затронутых детей, черновик очищается от удалённых фото
22. При сохранении: валидация существования фото перед вставкой в selections
23. Ошибки сабмита показываются inline и возвращают на нужный шаг

### Учителя (/teacher/[token])
24. Клик по фото = выбор (плюсик убран)
25. Фото выбранное другим учителем заблокировано (замок + серый цвет)
26. В лайтбоксе заблокированное фото показывает плашку вместо кнопки выбора
27. Фикс: фото сохраняется через delete+insert вместо upsert

### CSV экспорт (для верстальщики)
Колонки: Класс, Ученик, Портрет_страница, URL_портрет_страница, Обложка,
Портрет_обложка, URL_портрет_обложка, Текст, Фото_друзья_1..10, URL_фото_1..10
В конце файла — пустая строка и блок УЧИТЕЛЬ (ФИО, должность в колонке Обложка, фото)

---

## ИНСТРУМЕНТ СОРТИРОВКИ ФОТО

Файл: sort_photos.py (Python 3, tkinter GUI)
Запуск: python3 sort_photos.py

Два поля:
1. Папка с исходниками (содержит подпапки: Портреты/, 2-5/, Учителя/)
2. CSV файл экспорта

Результат создаётся в папке «Готово» внутри папки с исходниками.
Структура: [Класс] — [Ученик]/ → Портрет.jpg, Обложка.jpg (если other), Фото_1.jpg...
Папка УЧИТЕЛЯ/ → [ФИО].jpg

---

## ЛИМИТЫ СЕРВИСОВ

**Vercel** (Free):
- 100GB трафика/месяц
- 100 часов serverless/месяц
- Платный: $20/месяц

**Supabase** (Free):
- 500MB база данных
- 1GB хранилище фото (~5 альбомов по 125 фото)
- 2GB трафика/месяц
- Платный: $25/месяц → 8GB хранилище

**GitHub** — бесплатно без ограничений для данного проекта

---

## ЧТО ЕЩЁ НЕ СДЕЛАНО

1. Sharp на сервере — лучшее качество сжатия
2. Мультиаренда (несколько фотографов)
3. Очистка сирот в Storage при удалении фото через кнопку в галерее (вручную через Supabase)

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
