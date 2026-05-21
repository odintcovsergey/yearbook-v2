-- РЭ.30.3: очистка смешанных пресетов (одновременно заполнены density
-- и student_layout_mode).
--
-- Контекст (см. docs/phase-Р30-spec.md §Б.3 и phase-Р30-diagnostic.md
-- §«Финальная диагностика»):
-- В диагностике 21.05.2026 обнаружены 2 партнёрских пресета Сергея со
-- смешанным состоянием:
--   • blank-w7lygmuy («Мой шаблон»)  — density='universal' + layout_mode='page'
--   • custom-l34kwu6p («Мой Мини»)   — density='universal' + layout_mode='page'
-- Эти пресеты получились из бага PresetEditorModal: при сохранении он
-- одновременно писал density И student_layout_mode. Engine для таких
-- пресетов ведёт себя непредсказуемо (зависит от того, какое поле
-- проверится первым).
--
-- Баг закрыт коммитом РЭ.30.2 (73cd5ed) — фронт больше не пишет density
-- при сохранении. Эта миграция чистит исторические данные.
--
-- Что делает:
--   Для всех пресетов где student_layout_mode IS NOT NULL — обнуляет
--   density и sheet_type (если они ещё не NULL).
--
-- После Б.1 все 7 глобальных пресетов уже мигрированы (density=NULL у
-- всех). Поэтому реальный эффект миграции — только на партнёрских
-- смешанных пресетах.
--
-- Безопасность:
--   • Чистые legacy-пресеты (density заполнен, layout_mode=NULL) НЕ
--     затрагиваются — фильтр `student_layout_mode IS NOT NULL`.
--   • Чистые семантические пресеты (density=NULL, layout_mode заполнен)
--     уже в целевом состоянии — UPDATE no-op (или фильтр не пускает).
--   • Не зависит от tenant_id — применяется к глобальным и партнёрским
--     одинаково (для глобальных уже no-op после Б.1).
--
-- Идемпотентно: повторное применение даёт тот же результат (NULL → NULL).

-- ─── Обнуление density и sheet_type у смешанных пресетов ─────────────────
UPDATE presets
SET
  density = NULL,
  sheet_type = NULL
WHERE student_layout_mode IS NOT NULL
  AND (density IS NOT NULL OR sheet_type IS NOT NULL);

-- ─── Проверка результата ──────────────────────────────────────────────────
-- SELECT id, display_name, tenant_id, density, sheet_type, student_layout_mode
-- FROM presets
-- WHERE student_layout_mode IS NOT NULL
-- ORDER BY tenant_id NULLS FIRST, id;
--
-- Ожидание: у всех строк density = NULL и sheet_type = NULL.
--           student_layout_mode заполнен.
--
-- Дополнительная проверка — есть ли ещё смешанные:
-- SELECT count(*) AS mixed_remaining
-- FROM presets
-- WHERE student_layout_mode IS NOT NULL
--   AND (density IS NOT NULL OR sheet_type IS NOT NULL);
--
-- Ожидание: 0.
