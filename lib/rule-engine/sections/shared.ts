/**
 * Общий контекст для функций-секций (sections/*.ts).
 *
 * Каждая функция-секция получает ссылку на `SectionFillContext` и
 * мутирует его поля `pageInstances` / `warnings` / `decisionTrace` /
 * `available`. Это типичная архитектура для билдеров: контекст-объект
 * передаётся по ссылке, мутации накапливаются.
 *
 * Контекст создаётся в orchestrator-е (build-from-section-structure.ts)
 * один раз на запуск buildFromSectionStructure.
 */

import type { RuleEngineBundle } from '../loaders';
import type {
  DecisionTraceEntry,
  PageInstance,
  RulesAlbumInput,
} from '../types';
import type { CommonPhotoCounts } from '../slot-chains';

export interface SectionFillContext {
  /** Загруженные данные пресета + правила + мастера. */
  bundle: RuleEngineBundle;

  /** Вход — данные альбома (students, subjects, head_teacher, common_photos). */
  input: RulesAlbumInput;

  /**
   * Остаток общих фото после уже потреблённых секциями.
   * Каждая секция, расходующая общие фото (common, teachers, students-combined),
   * декрементит эти счётчики.
   */
  available: CommonPhotoCounts;

  /** Накопитель страниц. Позиция (left/right) определяется чётностью index. */
  pageInstances: PageInstance[];

  /** Накопитель decision_trace для отладки. */
  decisionTrace: DecisionTraceEntry[];

  /** Накопитель warnings (slot_skipped, master_not_found, не-implemented секции). */
  warnings: string[];

  /** Индекс текущей секции в preset.section_structure (для decision_trace.section_index). */
  sectionIndex: number;
}

/**
 * РЭ.37.3.b.2 (25.05.2026): человекочитаемое имя категории фото для warning'ов,
 * адресованных партнёру (не разработчику). Используется в формулировках
 * вроде "не хватило фото типа …", чтобы было понятно куда докинуть фото
 * в UI Окейбуки.
 *
 * Категории соответствуют ярлыкам в UI загрузки: common_full, common_half,
 * common_sixth, common_quarter, common_spread.
 */
export function humanPhotoCategory(category: string): string {
  switch (category) {
    case 'full_class':
      return 'общие фото класса (на всю страницу)';
    case 'half_class':
      return 'общие половинные фото (две на разворот)';
    case 'sixth':
      return 'общие фото для коллажа (шесть на страницу)';
    case 'quarter':
      return 'общие четвертные фото (четыре на страницу)';
    case 'spread':
      return 'общие фото на разворот';
    default:
      return category;
  }
}
