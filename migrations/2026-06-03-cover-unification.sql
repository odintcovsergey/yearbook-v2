-- Обложка альбома — Объединение двух систем, Этап 1: модель данных.
--
-- КОНТЕКСТ. Сейчас обложкой управляют ДВЕ системы (см. CLAUDE.md):
--   СТАРАЯ — albums.cover_mode / cover_price + таблица cover_selections.
--            Отвечает на вопрос «какое ФОТО на портретной обложке и сколько
--            доплатить». Живой родительский шаг «Портрет для обложки».
--   НОВАЯ  — covers (библиотека) + albums.cover_layout_mode/cover_default_type/
--            cover_available_ids + таблица cover_choices (от 2026-06-02).
--            Отвечает на вопрос «КАКАЯ обложка (дизайн/тип) и кто её выбирает».
--            Родительский экран ещё НЕ построен.
--
-- ЦЕЛЬ ОБЪЕДИНЕНИЯ. Новая система становится единственным владельцем: «какая
-- обложка» (новая) → если портретная, то «какое фото + доплата» (вложенный
-- под-вопрос, переезжает из старой). Эта миграция достраивает НОВУЮ модель,
-- чтобы она могла хранить всё. Старую (cover_mode/cover_selections) НЕ трогаем —
-- она остаётся живой до этапа 4 (перенос старых заказов + удаление).
--
-- ТРЕБУЕТ: применить ПОСЛЕ migrations/2026-06-02-cover-foundation.sql
--          (нужны таблица cover_choices и колонки обложки в albums).
--
-- БЕЗОПАСНОСТЬ. Всё аддитивно (только add column), значения по умолчанию
-- NULL/0 → новая система остаётся «спящей», пока партнёр не загрузит обложки и
-- не настроит альбом. Текущие заказы не затрагиваются.
--
-- Откат:
--   alter table albums drop column if exists cover_portrait_charge;
--   alter table cover_choices drop column if exists photo_option,
--     drop column if exists surcharge;

-- ── 1. Триггер доплаты за портрет на обложке (на заказе) ────────────────────
-- Заменяет смысловую роль старого cover_mode в части ДЕНЕГ. Покрывает оба
-- случая, которые бывают у партнёров:
--   'none'           — портрет на обложке бесплатен всегда.
--   'different_photo'— тот же портрет, что внутри, бесплатно; ДРУГОЕ фото за
--                      доплату (старый cover_mode='optional').
--   'any_portrait'   — любой портрет на обложке платный (старый 'required'
--                      «все платят» — портретная обложка сама по себе платная).
-- Сумма доплаты НЕ дублируется — берётся из существующего albums.cover_price.
-- NULL = не настроено (новая система спит).
alter table albums
  add column if not exists cover_portrait_charge text
    check (cover_portrait_charge is null
      or cover_portrait_charge in ('none','different_photo','any_portrait'));

comment on column albums.cover_portrait_charge is
  'Когда брать доплату за портрет на обложке (НОВАЯ система): none / different_photo (только за другое фото) / any_portrait (за любой портрет). Сумма — в albums.cover_price. NULL = не настроено.';

-- ── 2. Выбор фото и доплата на стороне родителя (cover_choices) ─────────────
-- В новой системе cover_choices становится ЕДИНОЙ метаданными выбора обложки.
-- Само ФОТО обложки по-прежнему хранится в selections (selection_type=
-- 'portrait_cover') — как портрет страницы и групповые, чтобы билдер/PDF
-- читали его без изменений. Здесь — лишь метаданные «то же/другое» и
-- зафиксированная на момент заказа сумма (snapshot, не зависит от поздних
-- правок cover_price).
alter table cover_choices
  add column if not exists photo_option text
    check (photo_option is null or photo_option in ('same','other')),
  add column if not exists surcharge integer not null default 0;

comment on column cover_choices.photo_option is
  'Какой портрет на обложке выбрал родитель: same (то же, что на странице) / other (другое фото). NULL для не-портретных обложек.';
comment on column cover_choices.surcharge is
  'Зафиксированная доплата (₽) на момент заказа. Snapshot albums.cover_price по правилу cover_portrait_charge.';

-- ── Проверка после миграции ────────────────────────────────────────────────
-- \d albums         → есть cover_portrait_charge (text, nullable)
-- \d cover_choices  → есть photo_option (text), surcharge (int default 0)
