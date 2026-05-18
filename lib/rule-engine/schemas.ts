/**
 * Rule Engine — Zod схемы для runtime-валидации.
 *
 * Используется:
 * - При сидинге глобальных правил/пресетов из JSON-файлов в `docs/rule-engine-data/`
 * - При сохранении пользовательских пресетов через API
 * - В тестах для проверки корректности структур
 *
 * Спецификация: docs/rule-engine-spec.md v1.1 §7-8.
 */

import { z } from 'zod';

// =============================================================================
// 1. Перечисления
// =============================================================================

export const DensitySchema = z.enum([
  'maximum',
  'universal',
  'standard',
  'medium',
  'light',
  'mini',
]);

export const PageTypeSchema = z.enum([
  'page-left',
  'page-right',
  'page-any',
  'spread',
]);

export const PrintTypeSchema = z.enum(['layflat', 'soft', 'tryumo']);

// =============================================================================
// 2. When clause
// =============================================================================

export const WhenOperatorSchema: z.ZodTypeAny = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.object({ eq: z.any() }).strict(),
  z.object({ neq: z.any() }).strict(),
  z.object({ gte: z.number() }).strict(),
  z.object({ lte: z.number() }).strict(),
  z.object({ gt: z.number() }).strict(),
  z.object({ lt: z.number() }).strict(),
  z.object({ between: z.tuple([z.number(), z.number()]) }).strict(),
  z.object({ in: z.array(z.any()) }).strict(),
  z.object({ not_in: z.array(z.any()) }).strict(),
  z.object({ has: z.boolean() }).strict(),
  z.object({ count_gte: z.number() }).strict(),
  z.object({ count_lte: z.number() }).strict(),
  z.object({ count_between: z.tuple([z.number(), z.number()]) }).strict(),
]);

export const WhenClauseSchema = z.record(z.string(), WhenOperatorSchema);

// =============================================================================
// 3. MasterSelector / Produces
// =============================================================================

export const MasterSelectorSchema = z
  .object({
    parametric: z.string(),
    params: z.record(z.string(), z.union([z.string(), z.number()])),
  })
  .strict();

export const MasterRefSchema = z.union([z.string(), MasterSelectorSchema]);

export const ProducesSpreadSchema = z
  .object({
    type: z.literal('spread'),
    left_master: MasterRefSchema,
    right_master: MasterRefSchema,
    start_on_right_page: z.boolean().optional(),
  })
  .strict();

export const ProducesPageSchema = z
  .object({
    type: z.literal('page'),
    side: z.enum(['left', 'right', 'any']),
    master: MasterRefSchema,
  })
  .strict();

export const ProducesSequenceSchema = z
  .object({
    type: z.literal('sequence'),
    steps: z.array(z.union([ProducesSpreadSchema, ProducesPageSchema])),
  })
  .strict();

export const ProducesSchema = z.discriminatedUnion('type', [
  ProducesSpreadSchema,
  ProducesPageSchema,
  ProducesSequenceSchema,
]);

// =============================================================================
// 4. Bind
// =============================================================================

export const BindValueSchema = z.union([
  z.string(),
  z
    .object({
      template: z.string().optional(),
      params: z.record(z.string(), z.any()).optional(),
      expr: z.string().optional(),
      skip_if: z.string().optional(),
    })
    .strict(),
]);

export const BindSchema = z.record(z.string(), BindValueSchema);

// =============================================================================
// 5. Consumes / Balance
// =============================================================================

export const ConsumesClauseSchema = z
  .object({
    students: z.union([z.number(), z.string()]).optional(),
    common_photos: z
      .object({
        full_class: z.number().optional(),
        half_class: z.number().optional(),
        spread: z.number().optional(),
        quarter: z.number().optional(),
        sixth: z.number().optional(),
      })
      .strict()
      .optional(),
    // РЭ.20.6: бюджет страниц альбома (см. ConsumesClause.pages в types.ts).
    pages: z.number().optional(),
    // РЭ.20.6: продвижение по mandatory_section.pages_pattern.
    mandatory_section: z
      .object({
        pages: z.number().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const BalanceClauseSchema = z
  .object({
    placeholder_centering: z.boolean().optional(),
    hide_unfilled: z.boolean().optional(),
  })
  .strict();

// =============================================================================
// 6. Rule (self-referential через z.lazy для variants)
// =============================================================================

const baseRuleFields = {
  id: z.string().min(1),
  family_id: z.string().min(1),
  family_version: z.string().min(1),
  priority: z.number().int(),
  when: WhenClauseSchema,
  produces: ProducesSchema,
  bind: z.record(z.string(), BindSchema).optional(),
  consumes: ConsumesClauseSchema.optional(),
  balance: BalanceClauseSchema.optional(),
  display_name: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
};

export interface RuleSchemaType {
  id: string;
  family_id: string;
  family_version: string;
  priority: number;
  when: Record<string, unknown>;
  produces: unknown;
  bind?: Record<string, Record<string, unknown>>;
  consumes?: unknown;
  balance?: unknown;
  display_name?: string;
  description?: string;
  enabled?: boolean;
  variants?: RuleSchemaType[];
}

export const RuleSchema: z.ZodType<RuleSchemaType> = z.lazy(() =>
  z
    .object({
      ...baseRuleFields,
      variants: z.array(RuleSchema).optional(),
    })
    .strict()
);

// =============================================================================
// 7. Family
// =============================================================================

export const FamilyParamSchema = z
  .object({
    type: z.enum(['enum', 'boolean', 'number', 'string']),
    values: z.array(z.any()).optional(),
    default: z.any().optional(),
    required: z.boolean().optional(),
    description: z.string().optional(),
  })
  .strict();

export const DensityConfigSchema = z
  .object({
    capacity_per_side: z.number().int().positive(),
    capacity_per_spread: z.number().int().positive(),
  })
  .strict();

export const TemplateFamilySchema = z
  .object({
    id: z.string().min(1),
    display_name: z.string().min(1),
    aliases: z.array(z.string()).default([]),
    deprecated: z.boolean().default(false),
    version: z.string().min(1),
    tenant_id: z.string().nullable(),
    params: z.record(z.string(), FamilyParamSchema).default({}),
    density_config: z
      .record(DensitySchema, DensityConfigSchema)
      .nullable()
      .optional(),
  })
  .strict();

// =============================================================================
// 8. Section / Preset
// =============================================================================

export const SectionParamsSchema = z
  .object({
    density: DensitySchema.optional(),
    has_quote: z.boolean().optional(),
    has_friend_photos: z.boolean().optional(),
    friend_photos_max: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
    portrait_source: z.string().optional(),
  })
  .strict();

export const SectionSchema = z
  .object({
    family_id: z.string().min(1),
    params: SectionParamsSchema.optional(),
    enabled_when: WhenClauseSchema.optional(),
    display_name: z.string().optional(),
  })
  .strict();

export const PresetSchema = z
  .object({
    id: z.string().min(1),
    display_name: z.string().min(1),
    print_type: PrintTypeSchema,
    pages_per_spread: z.number().int().positive(),
    version: z.string().min(1),
    sections: z.array(SectionSchema).min(1),
    parent_preset_id: z.string().optional(),
    tenant_id: z.string().nullable(),
    enabled: z.boolean().optional(),
  })
  .strict();

// =============================================================================
// 9. Матрица допустимых параметров секции по density (§4.4 spec'а)
// =============================================================================

export const DENSITY_PARAM_MATRIX: Record<
  z.infer<typeof DensitySchema>,
  { has_quote: boolean; has_friend_photos: boolean }
> = {
  maximum: { has_quote: true, has_friend_photos: true },
  universal: { has_quote: true, has_friend_photos: true },
  standard: { has_quote: true, has_friend_photos: false },
  medium: { has_quote: false, has_friend_photos: false },
  light: { has_quote: false, has_friend_photos: false },
  mini: { has_quote: false, has_friend_photos: false },
};

/**
 * Проверка параметров секции против матрицы §4.4.
 * Возвращает массив сообщений об ошибках. Пустой массив = всё ОК.
 *
 * Используется:
 * - При сохранении пресета через API (отклонить если есть ошибки)
 * - В buildFromRules перед применением правил секции (записать как warning)
 */
export function validateSectionParams(
  section: z.infer<typeof SectionSchema>
): string[] {
  const errors: string[] = [];
  const density = section.params?.density;
  if (!density) return errors;

  const allowed = DENSITY_PARAM_MATRIX[density];

  if (section.params?.has_quote === true && !allowed.has_quote) {
    errors.push(
      `Параметр has_quote=true не поддерживается для плотности '${density}' (см. spec §4.4)`
    );
  }
  if (section.params?.has_friend_photos === true && !allowed.has_friend_photos) {
    errors.push(
      `Параметр has_friend_photos=true не поддерживается для плотности '${density}' (см. spec §4.4)`
    );
  }
  if (
    section.params?.friend_photos_max !== undefined &&
    !allowed.has_friend_photos
  ) {
    errors.push(
      `Параметр friend_photos_max не применим к плотности '${density}' (фото с друзьями не поддерживаются)`
    );
  }

  return errors;
}
