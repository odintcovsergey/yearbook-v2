/**
 * Rule Engine — TypeScript типы
 *
 * Соответствует спецификации: docs/rule-engine-spec.md v1.1 §7-9.
 * Все типы только для time-of-compilation; runtime-валидация — schemas.ts.
 */

// =============================================================================
// 1. Перечисления
// =============================================================================

export type Density =
  | 'maximum'
  | 'universal'
  | 'standard'
  | 'medium'
  | 'light'
  | 'mini';

export type PageType = 'page-left' | 'page-right' | 'page-any' | 'spread';

export type PrintType = 'layflat' | 'soft' | 'tryumo';

export type LayoutStatus = 'ok' | 'partial' | 'failed';

// =============================================================================
// 2. Семейства мастеров (template_families)
// =============================================================================

export type FamilyId = string; // 'head-teacher' | 'student-section' | ...

export type FamilyVersion = string; // '1.0', '1.1', ...

export interface FamilyParam {
  type: 'enum' | 'boolean' | 'number' | 'string';
  values?: unknown[];
  default?: unknown;
  required?: boolean;
  description?: string;
}

export interface DensityConfig {
  capacity_per_side: number;
  capacity_per_spread: number;
}

export interface TemplateFamily {
  id: FamilyId;
  display_name: string;
  aliases: string[];
  deprecated: boolean;
  version: FamilyVersion;
  tenant_id: string | null;
  params: Record<string, FamilyParam>;
  density_config?: Partial<Record<Density, DensityConfig>> | null;
  created_at?: string;
  updated_at?: string;
}

// =============================================================================
// 3. Правила (rules) — when clause
// =============================================================================

export type WhenOperator =
  | number
  | string
  | boolean
  | { eq: unknown }
  | { neq: unknown }
  | { gte: number }
  | { lte: number }
  | { gt: number }
  | { lt: number }
  | { between: [number, number] }
  | { in: unknown[] }
  | { not_in: unknown[] }
  | { has: boolean }
  | { count_gte: number }
  | { count_lte: number }
  | { count_between: [number, number] };

export type WhenClause = Record<string, WhenOperator>;

// =============================================================================
// 4. Правила (rules) — produces clause
// =============================================================================

export interface MasterSelector {
  /** Имя параметрического мастера (например 'L-Grid-Page'). */
  parametric: string;
  /** Параметры для конкретного режима — slot_count, grid_mode и т.п. */
  params: Record<string, string | number>;
}

export type MasterRef = string | MasterSelector;

export interface ProducesSpread {
  type: 'spread';
  left_master: MasterRef;
  right_master: MasterRef;
  /** Если правило срабатывает при висящей правой странице — true. */
  start_on_right_page?: boolean;
}

export interface ProducesPage {
  type: 'page';
  side: 'left' | 'right' | 'any';
  master: MasterRef;
}

export interface ProducesSequence {
  type: 'sequence';
  steps: Array<ProducesSpread | ProducesPage>;
}

export type Produces = ProducesSpread | ProducesPage | ProducesSequence;

// =============================================================================
// 5. Правила (rules) — bind clause
// =============================================================================

/**
 * Значение для одной метки placeholder'а.
 *
 * Варианты:
 * - Строка-путь: 'input.head_teacher.photo'
 * - Параметрический шаблон: { template, params }
 * - Вычисляемое выражение: { expr }
 * - Любая комбинация с модификаторами (skip_if).
 */
export type BindValue =
  | string
  | {
      template?: string;
      params?: Record<string, unknown>;
      expr?: string;
      /** Если выражение возвращает true — пропустить эту метку. */
      skip_if?: string;
    };

/** Метки мастера → значения, которые подставить. */
export type Bind = Record<string, BindValue>;

// =============================================================================
// 6. Правила (rules) — consumes / balance / variants
// =============================================================================

export interface ConsumesClause {
  students?: number | string;
  common_photos?: {
    full_class?: number;
    half_class?: number;
    spread?: number;
    quarter?: number;
    sixth?: number;
  };
}

export interface BalanceClause {
  placeholder_centering?: boolean;
  hide_unfilled?: boolean;
}

export interface Rule {
  id: string;
  family_id: FamilyId;
  family_version: FamilyVersion;
  priority: number;
  when: WhenClause;
  produces: Produces;
  /** master_name → bindings для этого мастера. */
  bind?: Record<string, Bind>;
  consumes?: ConsumesClause;
  balance?: BalanceClause;
  variants?: Rule[];
  display_name?: string;
  description?: string;
  enabled?: boolean;
}

// =============================================================================
// 7. Пресеты (presets)
// =============================================================================

export interface SectionParams {
  density?: Density;
  /** Допустимо для max/universal/standard (см. §4.4). */
  has_quote?: boolean;
  /** Допустимо для max/universal (см. §4.4). */
  has_friend_photos?: boolean;
  friend_photos_max?: 2 | 3 | 4;
  /** Источник портрета. В MVP всегда 'default'. */
  portrait_source?: string;
}

export interface Section {
  family_id: FamilyId;
  params?: SectionParams;
  enabled_when?: WhenClause;
  display_name?: string;
}

export interface Preset {
  id: string;
  display_name: string;
  print_type: PrintType;
  pages_per_spread: number;
  version: string;
  sections: Section[];
  /** Если копия глобального — ссылка на родителя. */
  parent_preset_id?: string;
  tenant_id: string | null;
  enabled?: boolean;
}

// =============================================================================
// 8. Алгоритм buildFromRules — входы и выходы
// =============================================================================

export interface RulesStudentInput {
  id?: string;
  portrait: string | null;
  full_name: string;
  quote?: string | null;
  friend_photos?: string[];
  /** Заложено для будущей виньетки с детскими садиковыми фото. В MVP не используется. */
  secondary_portraits?: string[];
}

export interface RulesSubjectInput {
  photo: string | null;
  name: string;
  role: string;
}

export interface RulesHeadTeacherInput {
  photo: string | null;
  name: string;
  role: string;
  text: string;
}

export interface RulesCommonPhotosInput {
  full_class: string[];
  half_class: string[];
  spread: string[];
  quarter: string[];
  sixth: string[];
}

export interface RulesAlbumInput {
  students: RulesStudentInput[];
  subjects: RulesSubjectInput[];
  head_teacher: RulesHeadTeacherInput;
  common_photos: RulesCommonPhotosInput;
  /**
   * Лимит разворотов в общем разделе. РЭ.18.
   *   - undefined/null = без ограничения (builder вставляет все фото)
   *   - 0 = общий раздел полностью отключён
   *   - >0 = жёсткий лимит количества разворотов
   *
   * Передаётся в ctx как `common_section.max_spreads` и `common_section.spreads_remaining`.
   * Правила common-section-*-pair используют эти поля в when'ах.
   * Значение из albums.common_section_max_spreads через legacy-adapter.
   */
  common_section_max_spreads?: number | null;
}

// =============================================================================
// 9. Алгоритм buildFromRules — выходные структуры
// =============================================================================

export interface PageInstance {
  /** ID мастера из spread_templates. */
  master_id: string;
  /** Имя метки → значение (URL фото, текст, …). */
  bindings: Record<string, unknown>;
}

export interface SpreadInstance {
  spread_index: number;
  left?: PageInstance;
  right?: PageInstance;
  /** true для type='spread' (например J-Spread занимает оба листа). */
  is_spread?: boolean;
  /** true если левая и правая страницы из разных семейств (смешанный разворот). */
  mixed_pages?: boolean;
  /** true если партнёр редактировал разворот вручную. */
  user_edited?: boolean;
  user_edits?: Record<string, unknown>;
}

export interface DecisionTraceEntry {
  spread_index: number;
  section_index: number;
  family_id: FamilyId;
  rule_id: string;
  variant_id?: string;
  mixed_pages?: {
    left_rule_id: string;
    right_rule_id: string;
  };
  /** Снимок ключевых полей контекста на момент применения правила. */
  inputs: Record<string, unknown>;
  /** Применена ли балансировка к этому развороту. */
  balanced?: boolean;
}

export interface AlbumLayout {
  spreads: SpreadInstance[];
  decision_trace: DecisionTraceEntry[];
  rules_version: string;
  preset_id: string;
  status: LayoutStatus;
  warnings: string[];
}

// =============================================================================
// 10. Контекст вычисления правил (внутренний)
// =============================================================================

/**
 * Контекст для evaluateWhen — снимок всех полей из spec §7.2.
 * Заполняется в buildContext перед применением каждого правила.
 */
export interface RuleContext {
  subjects_count: number;
  students_count: number;
  students_remaining: number;
  current_student_index: number;
  head_teacher: {
    has_photo: boolean;
    has_text: boolean;
  };
  common_photos: {
    full_class: { count: number; has_any?: boolean };
    half_class: { count: number; has_any?: boolean };
    spread: { count: number; has_any?: boolean };
    quarter: { count: number; has_any?: boolean };
    sixth: { count: number; has_any?: boolean };
  };
  print_type: PrintType;
  section: {
    position: 'first' | 'middle' | 'last';
    density?: Density;
    has_quote?: boolean;
    has_friend_photos?: boolean;
    friend_photos_max?: number;
  };
  prev_spread: {
    right_page_empty: boolean;
  };
  /**
   * Состояние общего раздела (РЭ.18). Используется правилами
   * common-section-* для соблюдения лимита из
   * albums.common_section_max_spreads.
   *
   *   spreads_created      — сколько разворотов уже добавил builder в раздел
   *   max_spreads          — лимит из input (null/undefined = без лимита)
   *   spreads_remaining    — сколько ещё можно добавить
   *                           (null = unlimited, >=0 если есть лимит)
   *
   * В when'ах правил пишется как
   *   "common_section.spreads_remaining": { "gte": 1 }
   * либо просто "common_section.max_spreads": { "neq": 0 } (не отключён).
   */
  common_section: {
    spreads_created: number;
    max_spreads: number | null;
    spreads_remaining: number | null;
  };
  friend_photos_count?: number;
}
