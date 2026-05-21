-- РЭ.27.7: миграция данных + слияние дубль-пресетов config_presets.
-- ВЕРСИЯ 2 (21.05.2026) — после проверки реальной схемы БД.
--
-- ⚠️ КРИТИЧЕСКАЯ МИГРАЦИЯ — затрагивает живые альбомы и пресеты.
-- ПЕРЕД ПРИМЕНЕНИЕМ: снапшот таблиц albums и config_presets через
-- Supabase Dashboard → Database → Backups.
--
-- Контекст:
-- После РЭ.27 тип переплёта переехал в albums.print_type. Это позволяет
-- слить дубль-пресеты вида 'standard-layflat' / 'standard-soft' в один
-- 'standard' — содержательно они идентичны.
--
-- ───────────────────────────────────────────────────────────────────────────
-- Реальная схема (подтверждено 21.05.2026):
-- ───────────────────────────────────────────────────────────────────────────
--   albums.config_preset_id            uuid NULL   → FK на config_presets.id (uuid)
--   albums.print_type                  text NULL   ← наша новая колонка
--   albums.section_structure_preset_id text NULL   → FK на presets.id (uuid, мягкая связь)
--   config_presets.id                  uuid NOT NULL  (PK)
--   config_presets.slug                text NOT NULL  (human-readable ярлык, не ключ)
--   config_presets.print_type          text NOT NULL  (legacy, заполнено везде)
--   config_presets.tenant_id           uuid NULL      (мульти-тенантность)
--
-- Связь albums ↔ config_presets — ЧЕРЕЗ UUID (config_preset_id = id).
-- slug — это лейбл для UI и legacy preset_slug-flow в форме создания
-- альбома. Менять slug безопасно — FK не зависит от него.
--
-- ───────────────────────────────────────────────────────────────────────────
-- Состояние БД (выгружено Сергеем 21.05.2026):
-- ───────────────────────────────────────────────────────────────────────────
-- albums.print_type (12 записей): layflat=4, soft=2, NULL=6
--
-- config_presets (14 записей = 7 пар layflat+soft):
--   individual-layflat = 98bfb269-1f07-47d8-8e94-8a3ab5142d3c
--   individual-soft    = a126aace-e734-4369-ba2a-6f27b9c084ea
--   light-layflat      = 7b8dc24f-e014-49ec-9e08-758f812c7517
--   light-soft         = f6c85995-da95-4029-b703-bbdd22e28dbc
--   maximum-layflat    = eafedb11-5508-4996-9062-dde288436bf4
--   maximum-soft       = d0216518-509b-4252-8f28-41352fbe6596
--   medium-layflat     = 3587a91a-29ff-4caf-b759-544b6747c5bd
--   medium-soft        = ed762ba1-72e2-428d-a7d2-6d7bcbb05ba7
--   mini-layflat       = ecb6c08c-43f7-4d34-b2d3-5fcdb781bb94
--   mini-soft          = 4cdcec39-0978-47b1-bb23-d74ec54b9cd5
--   standard-layflat   = e510b344-6e39-4a97-ac90-7ac982bcaec6
--   standard-soft      = e583453a-2f10-4bcb-9ff1-df69f0b003bd
--   universal-layflat  = 1949575a-9c74-4672-842a-e2cfa41bc2c8
--   universal-soft     = acaea778-6a16-40bf-b7cf-1959c8d9fa21
--
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

-- ━━━ ШАГ 1: заполнение albums.print_type у NULL-альбомов ━━━━━━━━━━━━━━━━━━━
-- Через JOIN UUID = UUID (config_preset_id = id). Никаких slug.
UPDATE albums a
SET print_type = cp.print_type
FROM config_presets cp
WHERE a.config_preset_id = cp.id
  AND a.print_type IS NULL;

-- Контроль: SELECT print_type, COUNT(*) FROM albums GROUP BY print_type;
-- Ожидание: NULL = 0 (все 6 заполнены, потому что у пресетов print_type NOT NULL).

-- ━━━ ШАГ 2: перепривязка soft → layflat (uuid → uuid) ━━━━━━━━━━━━━━━━━━━━━
-- Если есть альбом ссылающийся на soft-вариант, заменяем на layflat-вариант.
-- Содержательно пресеты идентичны, отличался только print_type — уже в albums.

UPDATE albums SET config_preset_id = '98bfb269-1f07-47d8-8e94-8a3ab5142d3c'::uuid
WHERE config_preset_id = 'a126aace-e734-4369-ba2a-6f27b9c084ea'::uuid;
-- individual-layflat ← individual-soft

UPDATE albums SET config_preset_id = '7b8dc24f-e014-49ec-9e08-758f812c7517'::uuid
WHERE config_preset_id = 'f6c85995-da95-4029-b703-bbdd22e28dbc'::uuid;
-- light-layflat ← light-soft

UPDATE albums SET config_preset_id = 'eafedb11-5508-4996-9062-dde288436bf4'::uuid
WHERE config_preset_id = 'd0216518-509b-4252-8f28-41352fbe6596'::uuid;
-- maximum-layflat ← maximum-soft

UPDATE albums SET config_preset_id = '3587a91a-29ff-4caf-b759-544b6747c5bd'::uuid
WHERE config_preset_id = 'ed762ba1-72e2-428d-a7d2-6d7bcbb05ba7'::uuid;
-- medium-layflat ← medium-soft

UPDATE albums SET config_preset_id = 'ecb6c08c-43f7-4d34-b2d3-5fcdb781bb94'::uuid
WHERE config_preset_id = '4cdcec39-0978-47b1-bb23-d74ec54b9cd5'::uuid;
-- mini-layflat ← mini-soft

UPDATE albums SET config_preset_id = 'e510b344-6e39-4a97-ac90-7ac982bcaec6'::uuid
WHERE config_preset_id = 'e583453a-2f10-4bcb-9ff1-df69f0b003bd'::uuid;
-- standard-layflat ← standard-soft

UPDATE albums SET config_preset_id = '1949575a-9c74-4672-842a-e2cfa41bc2c8'::uuid
WHERE config_preset_id = 'acaea778-6a16-40bf-b7cf-1959c8d9fa21'::uuid;
-- universal-layflat ← universal-soft

-- ━━━ ШАГ 3: удаление осиротевших soft-пресетов ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- После шага 2 на soft-варианты никто не ссылается. Удаляем по slug
-- (читаемее в логе чем по UUID).
DELETE FROM config_presets
WHERE slug IN (
  'individual-soft',
  'light-soft',
  'maximum-soft',
  'medium-soft',
  'mini-soft',
  'standard-soft',
  'universal-soft'
);

-- ━━━ ШАГ 4: переименование оставшихся layflat-вариантов ━━━━━━━━━━━━━━━━━━━
-- FK через UUID, slug не задействован — это безопасно.
-- Меняем только slug и name; print_type оставляем 'layflat' (NOT NULL).
-- Партнёр в каталоге увидит чистый список без суффиксов.

UPDATE config_presets SET slug = 'individual', name = 'Индивидуальный'
WHERE slug = 'individual-layflat';

UPDATE config_presets SET slug = 'light', name = 'Лайт'
WHERE slug = 'light-layflat';

UPDATE config_presets SET slug = 'maximum', name = 'Максимум'
WHERE slug = 'maximum-layflat';

UPDATE config_presets SET slug = 'medium', name = 'Медиум'
WHERE slug = 'medium-layflat';

UPDATE config_presets SET slug = 'mini', name = 'Мини'
WHERE slug = 'mini-layflat';

UPDATE config_presets SET slug = 'standard', name = 'Стандарт'
WHERE slug = 'standard-layflat';

UPDATE config_presets SET slug = 'universal', name = 'Универсал'
WHERE slug = 'universal-layflat';

-- ━━━ КОНТРОЛЬНЫЕ ПРОВЕРКИ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. config_presets: ровно 7 записей с чистыми slug'ами.
-- SELECT slug, name, print_type FROM config_presets ORDER BY slug;

-- 2. Распределение по типам переплёта: layflat + soft = 12, NULL = 0.
-- SELECT print_type, COUNT(*) FROM albums GROUP BY print_type;

-- 3. Целостность FK: 0 строк.
-- SELECT a.id, a.config_preset_id FROM albums a
-- LEFT JOIN config_presets cp ON cp.id = a.config_preset_id
-- WHERE a.config_preset_id IS NOT NULL AND cp.id IS NULL;

COMMIT;

-- ───────────────────────────────────────────────────────────────────────────
-- ⚠️ ПОСЛЕ УСПЕШНОГО ПРИМЕНЕНИЯ:
-- ───────────────────────────────────────────────────────────────────────────
-- На стороне кода обновить submit-path в форме создания альбома
-- (app/app/page.tsx): preset_slug строится как
-- '${form.config_type}-${form.print_type}'. После слияния таких slug'ов
-- больше нет — нужно отправлять чистый '${form.config_type}'.
-- Это часть 2 подэтапа РЭ.27.7 (отдельный коммит после миграции).
