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
