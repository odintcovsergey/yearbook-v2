-- ─────────────────────────────────────────────────────────────────────────
-- РЭ.37.3 — стабы 6 combo-мастеров переходного раздела.
-- ─────────────────────────────────────────────────────────────────────────
--
-- Контекст:
-- Engine sections/transition.ts (РЭ.37.2.b) ищет combo-мастера через
-- findComboMaster по конвенции имён:
--
--     J-Combined-Tail-N         — для левой страницы разворота (L)
--     J-Combined-Tail-N-Right   — для правой (R, зеркало)
--
-- где N = capacity combo-мастера:
--   • N=4 — для Mini-комплектации   (N-Grid-12, M=4 портрета в combo)
--   • N=3 — для Light-комплектации  (N-Grid-6,  M=3)
--   • N=2 — для Medium-комплектации (N-Grid-4,  M=2)
--
-- Имена жёстко зашиты в lib/rule-engine/transition-cases.ts (SPECS).
-- Если мастера в template_set нет — engine выдаёт warning
-- transition_combo_master_missing и оставляет хвостовую страницу
-- students как есть (один портрет в углу N-Grid с пустыми ячейками).
--
-- Эта миграция создаёт СТРУКТУРНЫЕ СТАБЫ для всех 6 мастеров: placeholders
-- + slot_capacity по форме, которую ожидает engine. Геометрия placeholder'ов
-- (XY-координаты, ширины) — заглушки на основе «разумной сетки» для
-- предположения page 200×280 mm. Engine на координаты не смотрит
-- (pushCombinedTailPage сканирует placeholders по labels), поэтому стаб
-- функционально полноценен — engine начнёт класть combo сразу после
-- применения миграции.
--
-- Реальная вёрстка прилетит в РЭ.37.8: Сергей нарисует мастера в InDesign,
-- импортирует через convert-idml или вручную обновит placeholders через
-- /super/master-catalog (когда там появится inline-редактор геометрии).
--
-- ВАЖНО: Combo всегда асимметричен. Для R-версий координаты в стабе те же,
-- что в базовых — это не дефект, а признак стаба. В РЭ.37.8 R-версия станет
-- настоящим зеркалом (например, classphoto у внешнего края разворота).
--
-- ИДЕМПОТЕНТНОСТЬ:
-- Каждый INSERT защищён WHERE NOT EXISTS по (template_set_id, name).
-- Повторное применение миграции пройдёт без эффекта (0 строк затронуто).
-- Если кто-то уже добавил какой-то combo-мастер вручную через
-- /super/master-catalog с тем же именем — миграция его не перезапишет.
--
-- РАСКЛАДКА PLACEHOLDER'ОВ
-- ─────────────────────────
-- Page assumed = 200×280 mm (реальный размер берётся из template_sets ниже).
-- Координаты — приблизительно центрированная сетка портретов в верхней
-- 2/3 страницы + classphoto широкой полосой снизу. Имена — узкие текстовые
-- слоты сразу под каждым портретом.
--
--   Combo-2 (Medium):       Combo-3 (Light):        Combo-4 (Mini):
--   ┌───────┬───────┐       ┌─────┬─────┬─────┐     ┌───────┬───────┐
--   │  P1   │  P2   │       │ P1  │ P2  │ P3  │     │  P1   │  P2   │
--   │  N1   │  N2   │       │ N1  │ N2  │ N3  │     │  N1   │  N2   │
--   ├───────┴───────┤       ├─────┴─────┴─────┤     │  P3   │  P4   │
--   │  CLASS-PHOTO  │       │   CLASS-PHOTO   │     │  N3   │  N4   │
--   └───────────────┘       └─────────────────┘     │  CLASS-PHOTO  │
--                                                    └───────────────┘

DO $$
DECLARE
  v_set_id     uuid;
  v_page_w     numeric;
  v_page_h     numeric;
  v_inserted   int := 0;
  v_skipped    int := 0;

  -- Имя текущего мастера (для условного INSERT и сообщений).
  v_name       text;

  -- jsonb с placeholders для каждого варианта (M=2/3/4).
  v_combo_2_placeholders   jsonb;
  v_combo_3_placeholders   jsonb;
  v_combo_4_placeholders   jsonb;

  v_audit text := 'РЭ.37.3 STUB: structural record, real InDesign geometry comes in РЭ.37.8';
BEGIN
  -- ─── 1. Найти template_set и его размер страницы ────────────────────
  SELECT id, page_width_mm, page_height_mm
    INTO v_set_id, v_page_w, v_page_h
  FROM template_sets
  WHERE slug = 'okeybook-default' AND tenant_id IS NULL;

  IF v_set_id IS NULL THEN
    RAISE EXCEPTION 'template_sets okeybook-default (tenant_id IS NULL) не найден';
  END IF;

  RAISE NOTICE 'okeybook-default template_set: id=%, page=%×% mm',
    v_set_id, v_page_w, v_page_h;

  -- ─── 2. Подготовить placeholders для трёх вариантов ─────────────────

  -- Combo-2 (Medium): 2 портрета + 2 имени + 1 classphoto
  --   Портреты:  80×100 mm,  x={20, 100},  y=30
  --   Имена:     80×10 mm,   x={20, 100},  y=135
  --   Classphoto: 160×100 mm, x=20, y=160
  v_combo_2_placeholders := jsonb_build_array(
    jsonb_build_object('label','studentportrait_1','x_mm',20,'y_mm',30,'width_mm',80,'height_mm',100,'type','photo','fit','fill_proportional','required',false),
    jsonb_build_object('label','studentportrait_2','x_mm',100,'y_mm',30,'width_mm',80,'height_mm',100,'type','photo','fit','fill_proportional','required',false),
    jsonb_build_object('label','studentname_1','x_mm',20,'y_mm',135,'width_mm',80,'height_mm',10,'type','text','font_family','Arial','font_size_pt',12,'font_weight','regular','color','#000000','align','center','vertical_align','middle','auto_fit',false),
    jsonb_build_object('label','studentname_2','x_mm',100,'y_mm',135,'width_mm',80,'height_mm',10,'type','text','font_family','Arial','font_size_pt',12,'font_weight','regular','color','#000000','align','center','vertical_align','middle','auto_fit',false),
    jsonb_build_object('label','classphotoframe','x_mm',20,'y_mm',160,'width_mm',160,'height_mm',100,'type','photo','fit','fill_proportional','required',false)
  );

  -- Combo-3 (Light): 3 портрета + 3 имени + 1 classphoto
  --   Портреты:  55×75 mm,   x={15, 72, 130},  y=30
  --   Имена:     55×10 mm,   x={15, 72, 130},  y=110
  --   Classphoto: 170×100 mm, x=15, y=150
  v_combo_3_placeholders := jsonb_build_array(
    jsonb_build_object('label','studentportrait_1','x_mm',15,'y_mm',30,'width_mm',55,'height_mm',75,'type','photo','fit','fill_proportional','required',false),
    jsonb_build_object('label','studentportrait_2','x_mm',72,'y_mm',30,'width_mm',55,'height_mm',75,'type','photo','fit','fill_proportional','required',false),
    jsonb_build_object('label','studentportrait_3','x_mm',130,'y_mm',30,'width_mm',55,'height_mm',75,'type','photo','fit','fill_proportional','required',false),
    jsonb_build_object('label','studentname_1','x_mm',15,'y_mm',110,'width_mm',55,'height_mm',10,'type','text','font_family','Arial','font_size_pt',12,'font_weight','regular','color','#000000','align','center','vertical_align','middle','auto_fit',false),
    jsonb_build_object('label','studentname_2','x_mm',72,'y_mm',110,'width_mm',55,'height_mm',10,'type','text','font_family','Arial','font_size_pt',12,'font_weight','regular','color','#000000','align','center','vertical_align','middle','auto_fit',false),
    jsonb_build_object('label','studentname_3','x_mm',130,'y_mm',110,'width_mm',55,'height_mm',10,'type','text','font_family','Arial','font_size_pt',12,'font_weight','regular','color','#000000','align','center','vertical_align','middle','auto_fit',false),
    jsonb_build_object('label','classphotoframe','x_mm',15,'y_mm',150,'width_mm',170,'height_mm',100,'type','photo','fit','fill_proportional','required',false)
  );

  -- Combo-4 (Mini): 4 портрета 2×2 + 4 имени + 1 classphoto
  --   Портреты: 60×80 mm,  сетка 2×2: x={30, 110}, y={20, 115}
  --   Имена:    60×10 mm,  сразу под портретом: y={100, 195}
  --   Classphoto: 160×60 mm, x=20, y=215
  v_combo_4_placeholders := jsonb_build_array(
    jsonb_build_object('label','studentportrait_1','x_mm',30,'y_mm',20,'width_mm',60,'height_mm',80,'type','photo','fit','fill_proportional','required',false),
    jsonb_build_object('label','studentportrait_2','x_mm',110,'y_mm',20,'width_mm',60,'height_mm',80,'type','photo','fit','fill_proportional','required',false),
    jsonb_build_object('label','studentportrait_3','x_mm',30,'y_mm',115,'width_mm',60,'height_mm',80,'type','photo','fit','fill_proportional','required',false),
    jsonb_build_object('label','studentportrait_4','x_mm',110,'y_mm',115,'width_mm',60,'height_mm',80,'type','photo','fit','fill_proportional','required',false),
    jsonb_build_object('label','studentname_1','x_mm',30,'y_mm',100,'width_mm',60,'height_mm',10,'type','text','font_family','Arial','font_size_pt',11,'font_weight','regular','color','#000000','align','center','vertical_align','middle','auto_fit',false),
    jsonb_build_object('label','studentname_2','x_mm',110,'y_mm',100,'width_mm',60,'height_mm',10,'type','text','font_family','Arial','font_size_pt',11,'font_weight','regular','color','#000000','align','center','vertical_align','middle','auto_fit',false),
    jsonb_build_object('label','studentname_3','x_mm',30,'y_mm',195,'width_mm',60,'height_mm',10,'type','text','font_family','Arial','font_size_pt',11,'font_weight','regular','color','#000000','align','center','vertical_align','middle','auto_fit',false),
    jsonb_build_object('label','studentname_4','x_mm',110,'y_mm',195,'width_mm',60,'height_mm',10,'type','text','font_family','Arial','font_size_pt',11,'font_weight','regular','color','#000000','align','center','vertical_align','middle','auto_fit',false),
    jsonb_build_object('label','classphotoframe','x_mm',20,'y_mm',215,'width_mm',160,'height_mm',60,'type','photo','fit','fill_proportional','required',false)
  );

  -- ─── 3. Вставка 6 записей с идемпотентностью ─────────────────────────
  --
  -- Каждый INSERT через INSERT ... SELECT ... WHERE NOT EXISTS — повторное
  -- применение пропустит существующие записи (0 строк затронуто).

  -- ── 3.1. J-Combined-Tail-4 (Mini, L) ────────────────────────────────
  v_name := 'J-Combined-Tail-4';
  INSERT INTO spread_templates (
    id, template_set_id, name, type, is_spread,
    width_mm, height_mm, placeholders, rules, sort_order,
    applies_to_configs, default_for_configs,
    page_role, slot_capacity,
    is_fallback, mirror_for_soft, audit_notes, display_label,
    family_id, page_type, density, params, background_url
  )
  SELECT
    gen_random_uuid(), v_set_id, v_name, 'common', false,
    v_page_w, v_page_h, v_combo_4_placeholders, NULL, 0,
    ARRAY[]::text[], ARRAY[]::text[],
    'common', jsonb_build_object('students', 4, 'photos_full', 1),
    false, false, v_audit, 'Combo-4 хвост (Мини, L)',
    NULL, 'page-any', NULL, '{}'::jsonb, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM spread_templates
    WHERE template_set_id = v_set_id AND name = v_name
  );
  IF FOUND THEN v_inserted := v_inserted + 1;
    RAISE NOTICE 'inserted: %', v_name;
  ELSE v_skipped := v_skipped + 1;
    RAISE NOTICE 'skipped (already exists): %', v_name;
  END IF;

  -- ── 3.2. J-Combined-Tail-4-Right (Mini, R) ──────────────────────────
  v_name := 'J-Combined-Tail-4-Right';
  INSERT INTO spread_templates (
    id, template_set_id, name, type, is_spread,
    width_mm, height_mm, placeholders, rules, sort_order,
    applies_to_configs, default_for_configs,
    page_role, slot_capacity,
    is_fallback, mirror_for_soft, audit_notes, display_label,
    family_id, page_type, density, params, background_url
  )
  SELECT
    gen_random_uuid(), v_set_id, v_name, 'common', false,
    v_page_w, v_page_h, v_combo_4_placeholders, NULL, 0,
    ARRAY[]::text[], ARRAY[]::text[],
    'common', jsonb_build_object('students', 4, 'photos_full', 1),
    false, false, v_audit, 'Combo-4 хвост (Мини, R, зеркало)',
    NULL, 'page-any', NULL, '{}'::jsonb, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM spread_templates
    WHERE template_set_id = v_set_id AND name = v_name
  );
  IF FOUND THEN v_inserted := v_inserted + 1;
    RAISE NOTICE 'inserted: %', v_name;
  ELSE v_skipped := v_skipped + 1;
    RAISE NOTICE 'skipped (already exists): %', v_name;
  END IF;

  -- ── 3.3. J-Combined-Tail-3 (Light, L) ───────────────────────────────
  v_name := 'J-Combined-Tail-3';
  INSERT INTO spread_templates (
    id, template_set_id, name, type, is_spread,
    width_mm, height_mm, placeholders, rules, sort_order,
    applies_to_configs, default_for_configs,
    page_role, slot_capacity,
    is_fallback, mirror_for_soft, audit_notes, display_label,
    family_id, page_type, density, params, background_url
  )
  SELECT
    gen_random_uuid(), v_set_id, v_name, 'common', false,
    v_page_w, v_page_h, v_combo_3_placeholders, NULL, 0,
    ARRAY[]::text[], ARRAY[]::text[],
    'common', jsonb_build_object('students', 3, 'photos_full', 1),
    false, false, v_audit, 'Combo-3 хвост (Лайт, L)',
    NULL, 'page-any', NULL, '{}'::jsonb, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM spread_templates
    WHERE template_set_id = v_set_id AND name = v_name
  );
  IF FOUND THEN v_inserted := v_inserted + 1;
    RAISE NOTICE 'inserted: %', v_name;
  ELSE v_skipped := v_skipped + 1;
    RAISE NOTICE 'skipped (already exists): %', v_name;
  END IF;

  -- ── 3.4. J-Combined-Tail-3-Right (Light, R) ─────────────────────────
  v_name := 'J-Combined-Tail-3-Right';
  INSERT INTO spread_templates (
    id, template_set_id, name, type, is_spread,
    width_mm, height_mm, placeholders, rules, sort_order,
    applies_to_configs, default_for_configs,
    page_role, slot_capacity,
    is_fallback, mirror_for_soft, audit_notes, display_label,
    family_id, page_type, density, params, background_url
  )
  SELECT
    gen_random_uuid(), v_set_id, v_name, 'common', false,
    v_page_w, v_page_h, v_combo_3_placeholders, NULL, 0,
    ARRAY[]::text[], ARRAY[]::text[],
    'common', jsonb_build_object('students', 3, 'photos_full', 1),
    false, false, v_audit, 'Combo-3 хвост (Лайт, R, зеркало)',
    NULL, 'page-any', NULL, '{}'::jsonb, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM spread_templates
    WHERE template_set_id = v_set_id AND name = v_name
  );
  IF FOUND THEN v_inserted := v_inserted + 1;
    RAISE NOTICE 'inserted: %', v_name;
  ELSE v_skipped := v_skipped + 1;
    RAISE NOTICE 'skipped (already exists): %', v_name;
  END IF;

  -- ── 3.5. J-Combined-Tail-2 (Medium, L) ──────────────────────────────
  v_name := 'J-Combined-Tail-2';
  INSERT INTO spread_templates (
    id, template_set_id, name, type, is_spread,
    width_mm, height_mm, placeholders, rules, sort_order,
    applies_to_configs, default_for_configs,
    page_role, slot_capacity,
    is_fallback, mirror_for_soft, audit_notes, display_label,
    family_id, page_type, density, params, background_url
  )
  SELECT
    gen_random_uuid(), v_set_id, v_name, 'common', false,
    v_page_w, v_page_h, v_combo_2_placeholders, NULL, 0,
    ARRAY[]::text[], ARRAY[]::text[],
    'common', jsonb_build_object('students', 2, 'photos_full', 1),
    false, false, v_audit, 'Combo-2 хвост (Медиум, L)',
    NULL, 'page-any', NULL, '{}'::jsonb, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM spread_templates
    WHERE template_set_id = v_set_id AND name = v_name
  );
  IF FOUND THEN v_inserted := v_inserted + 1;
    RAISE NOTICE 'inserted: %', v_name;
  ELSE v_skipped := v_skipped + 1;
    RAISE NOTICE 'skipped (already exists): %', v_name;
  END IF;

  -- ── 3.6. J-Combined-Tail-2-Right (Medium, R) ────────────────────────
  v_name := 'J-Combined-Tail-2-Right';
  INSERT INTO spread_templates (
    id, template_set_id, name, type, is_spread,
    width_mm, height_mm, placeholders, rules, sort_order,
    applies_to_configs, default_for_configs,
    page_role, slot_capacity,
    is_fallback, mirror_for_soft, audit_notes, display_label,
    family_id, page_type, density, params, background_url
  )
  SELECT
    gen_random_uuid(), v_set_id, v_name, 'common', false,
    v_page_w, v_page_h, v_combo_2_placeholders, NULL, 0,
    ARRAY[]::text[], ARRAY[]::text[],
    'common', jsonb_build_object('students', 2, 'photos_full', 1),
    false, false, v_audit, 'Combo-2 хвост (Медиум, R, зеркало)',
    NULL, 'page-any', NULL, '{}'::jsonb, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM spread_templates
    WHERE template_set_id = v_set_id AND name = v_name
  );
  IF FOUND THEN v_inserted := v_inserted + 1;
    RAISE NOTICE 'inserted: %', v_name;
  ELSE v_skipped := v_skipped + 1;
    RAISE NOTICE 'skipped (already exists): %', v_name;
  END IF;

  RAISE NOTICE 'Итого: inserted=%, skipped=%', v_inserted, v_skipped;
END $$;

-- ─── Проверка после применения (раскомментируй и выполни в SQL Editor) ───
-- SELECT name, display_label, page_role, slot_capacity,
--        jsonb_array_length(placeholders) AS ph_count,
--        applies_to_configs, audit_notes
-- FROM spread_templates
-- WHERE template_set_id = (
--   SELECT id FROM template_sets
--   WHERE slug = 'okeybook-default' AND tenant_id IS NULL
-- )
--   AND name LIKE 'J-Combined-Tail-%'
-- ORDER BY name;
--
-- Ожидание: 6 строк
--   J-Combined-Tail-2          | Combo-2 хвост (Медиум, L)          | common | {"students":2,"photos_full":1} | 5
--   J-Combined-Tail-2-Right    | Combo-2 хвост (Медиум, R, зеркало) | common | {"students":2,"photos_full":1} | 5
--   J-Combined-Tail-3          | Combo-3 хвост (Лайт, L)            | common | {"students":3,"photos_full":1} | 7
--   J-Combined-Tail-3-Right    | Combo-3 хвост (Лайт, R, зеркало)   | common | {"students":3,"photos_full":1} | 7
--   J-Combined-Tail-4          | Combo-4 хвост (Мини, L)            | common | {"students":4,"photos_full":1} | 9
--   J-Combined-Tail-4-Right    | Combo-4 хвост (Мини, R, зеркало)   | common | {"students":4,"photos_full":1} | 9
