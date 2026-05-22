# Фаза РЭ.31 — Семантический общий раздел + полировка хвоста (CHERN)

**Статус**: 🟡 Черновик. Утверждается перед началом фазы.
**Источник**: диагностика боевого теста Тест2 (21.05.2026, ~23:50).
**Базовое состояние**: РЭ.30 закрыта (commit `ebfd5a1`), глобальные пресеты на семантике, общий раздел и transition — нет.
**Связано**: долг №1 в `phase-Р30-summary.md` («Семантический `common_required`»).

---

## Что показала диагностика

**Тестовый альбом**: Тест2, 25 учеников, 5 учителей, шаблон «Медиум (копия)» (партнёрский клон `clone-yzux0b16` от okeybook-default). Mode=`grid`, grid_size=4, has_quote=true.

**Результат сборки**: 9 элементов в 5 разворотах, 4 warning'а.

### Что работает после РЭ.30 ✅
- Учительский разворот (`teachers.ts`) — корректно, F-Head-Big + 4 ассистента
- Обязательный общий между учителями и студентами — сработал (это правильный порядок по дизайну OkeyBook, **не баг**, пометить в shared knowledge)
- Личный раздел (`students.ts` → `buildGridSemantic`) — 24 из 25 учеников разложены идеально на 6 разворотов
- Балансировка хвоста — **формально** работает: ветка 3a (combined-tail) нашла мастер `students=2, photos_full=1` и положила Фёдорову Варвару + classphoto. Логика верна, эстетика спорная.

### Что НЕ работает ❌

**1. Секция `transition` (1 warning)** — `lib/rule-engine/sections/transition.ts:89-95`:
```
transition_no_density: preset.density=null, sheet_type=hard — нельзя выбрать строку таблицы
```
Обработчик целиком построен на legacy-таблице OkeyBook (`pickRow(density, sheet_type, students)`). После Б.1 у глобальных пресетов `density=NULL`. Фолбэк работает только для `maximum/individual` (см. `resolveDensityForTable`).

**2. Секция `common_required` (1 warning)** — `lib/rule-engine/sections/common-required.ts:90-97`:
Та же беда, тот же `resolveDensityForTable`, тот же early-return. После Б.1 секция тихо не строится для большинства пресетов.

**3. `pages_underflow`** — следствие пунктов 1 и 2: получили 9 страниц при min_pages=16. Engine честно говорит «партнёр доберёт вручную». Это **симптом**, не причина.

**4. Эстетика хвоста (warning не выдан, но визуально некрасиво)** — `buildGridSemantic` ветка 3a сработала раньше 3b. Engine положил 1 ученика + classphoto в мастер на 2 человек, второй слот null. Альтернатива была: `students=1`, чистая страница (если такой мастер есть). Это **приоритизация веток** в `students.ts:746-795`.

---

## Цели фазы РЭ.31

1. **Перевести `transition.ts` на семантику** — читать `student_layout_mode` + `student_grid_size`, найти мастер семантически (J-* по slot_capacity), не из таблицы.
2. **Перевести `common_required.ts` на семантику** — найти J-* мастера по `slot_capacity.photos_full / photos_half / photos_quarter / photos_sixth`. Таблица OkeyBook остаётся как fallback для legacy-пресетов (density заполнен).
3. **Полировка балансировки хвоста** — поменять приоритет веток (или сделать настраиваемым в пресете): когда хвост = 1 ученик, по умолчанию выбирать `students=1` без classphoto, не «students=2 с пустым слотом + classphoto».
4. **Финальный тест на Тест2** — сборка без warning'ов на всех 7 глобальных пресетах.

---

## Структура фазы (план, может меняться)

### Этап A — Диагностика и инвентаризация

**A.1** Снять с Supabase реальный список J-* мастеров в `okeybook-default` template_set, их `slot_capacity`. Записать в spec — какие категории common-фото покрываются, какие пробелы.

**A.2** Проверить какие partner-template_set'ы существуют (включая `clone-yzux0b16` Сергея) — наследуют ли они J-* мастера, или их надо клонировать. Решение Сергея №NN из РЭ.28 — клон создаёт мастера с resize, значит должны быть.

**A.3** Зафиксировать ожидаемый порядок секций в layout (по дизайну OkeyBook): teachers → common_required (small) → students → transition → common_additional. Пометить в shared knowledge `lib/rule-engine/section-order.md` (если такого нет — создать).

### Этап Б — Семантический поиск J-* мастеров

**Б.1** Создать `findCommonMaster(mastersByName, request)` в `lib/rule-engine/master-finder.ts` по образцу `findStudentGridMaster`/`findTeacherMaster`. Параметры: `category` (full/half/quarter/sixth), `count`, `position` ('left'|'right'). Возвращает `{ master, lostPhotos }`.

**Б.2** Перевести `common-required.ts` на новый findCommonMaster:
- Если `preset.density` заполнен (legacy) → старый путь через `pickRow` остаётся
- Если `density=NULL` → новый семантический путь:
  - Для каждой страницы общего раздела: смотрим counters available (full_class, half, quarter, sixth)
  - Жадно пробуем заполнить — full→half→quarter→sixth по убыванию площади
  - findCommonMaster для каждой попытки
- Зеркальные мастера J-Quarter-Left/Right сохраняются.

**Б.3** Перевести `transition.ts` тем же подходом — но проще, всего одна страница.

**Б.4** Юнит-тесты для findCommonMaster + интеграционные для common-required и transition.

### Этап В — Полировка хвоста

**В.1** Изучить ветки 3a/3b/3c в `buildGridSemantic` (`students.ts:746-811`). Решить приоритет:
- Вариант A: 3b (adaptive students=remainder без classphoto) идёт раньше 3a (combined с classphoto)
- Вариант B: настройка на уровне пресета — `student_tail_priority: 'minimal_pad' | 'combined'`
- Решение принимать с Сергеем — это про эстетику, не про код.

**В.2** Реализовать выбранный вариант, тесты.

### Этап Г — Закрытие фазы

**Г.1** Полная сборка Тест2 на 7 глобальных пресетах (через цикл переключения шаблона), все warning'и должны исчезнуть.

**Г.2** Контекст vNNN + `docs/phase-Р31-summary.md`.

---

## Открытые вопросы (нужны решения Сергея)

1. **Приоритет хвоста**: что предпочтительнее по умолчанию — `students=1` чистая страница, или `students=2 + classphoto` с пустым слотом?
2. **Что делать с legacy density-веткой в `common_required`** — оставить как fallback или удалить (как удалили в РЭ.30 для students)?
3. **Параметры общего раздела в пресете** — сейчас `common_required` без параметров, engine сам выбирает страницы. Оставить так, или дать партнёру указать «хочу N разворотов в общем» (как уже есть в форме альбома — `common_section_limit`)?

---

## Эстимация

**2-3 сессии. ~10-14 коммитов. 0 SQL миграций (только код).**

Меньше чем РЭ.30 — потому что:
- БД уже в нужном состоянии после Б.1+Б.3 РЭ.30
- Семантические finder'ы уже есть для students/teachers — копируем шаблон для J-*
- Эстетика хвоста — точечная правка, не редизайн

---

## Что НЕ делаем в этой фазе

- Не трогаем legacy `buildAlbum` (старый движок для 12 production-альбомов)
- Не удаляем колонки `density`, `sheet_type` из БД
- Не делаем семантический `common_additional` (платный) — отдельной фазой
- Не делаем партнёрский IDML с нуля (РЭ.29) — отдельной фазой
