-- РЭ.50: cleanup мёртвых presets с NULL template_set_id.
--
-- Контекст:
--   На ранних этапах (до РЭ.21/24) поле template_set_id не было
--   обязательным. В результате в БД появились 3 невалидных пресета,
--   которые не могут собирать альбомы (без template_set engine не
--   найдёт мастеров) и в редакторе показываются как «Доработай».
--
-- Эти пресеты:
--   - custom-qgrz75n3 («Стандарт»)
--   - custom-l34kwu6p («Мой Мини»)
--   - custom-vrfxcuqi («Мой пресет для школ»)
--
-- Все они tenant-owned (не глобальные OkeyBook), template_set_id IS NULL.
--
-- Параллельно в код добавлен фильтр template_set_id IS NOT NULL в
-- endpoint'ах templates_list_my и templates_list_global, чтобы если в
-- будущем такие пресеты появятся снова (например, через прямой INSERT
-- или баг) — они не показывались в UI.
--
-- ⚠️ ВЫПОЛНЯТЬ ВРУЧНУЮ В SUPABASE STUDIO.
--    Перед DELETE — проверь что эти id ещё в БД:
--      SELECT id, display_name, tenant_id, template_set_id
--      FROM presets WHERE id IN (
--        'custom-qgrz75n3', 'custom-l34kwu6p', 'custom-vrfxcuqi'
--      );
--    Если результат пуст — пресеты уже удалены, миграция не нужна.

DELETE FROM presets
WHERE id IN (
  'custom-qgrz75n3',
  'custom-l34kwu6p',
  'custom-vrfxcuqi'
);

-- Проверка после удаления — должно вернуть 0:
-- SELECT COUNT(*) FROM presets WHERE template_set_id IS NULL;
