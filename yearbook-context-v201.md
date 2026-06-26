# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов → платформа для школьных фотографов
# Версия: v201
# Обновлено: 26.06.2026 (отказоустойчивый деплой — primary GitFlic, fallback GitHub; + аудит legacy + fail-fast STORAGE_BACKEND)
# HEAD: afbaff8 (main) на момент записи
#
# Предыдущий контекст: yearbook-context-v200.md (история не переписывается).

---

## 🆕 СЕССИЯ 26.06.2026 — отказоустойчивый деплой (GitFlic-primary) + аудит legacy + fail-fast STORAGE_BACKEND

(Ниже этой секции — историческое содержимое v199 про ТЗ адаптации формата, не переписывается.)

### ✅ DONE
- **Аудит legacy-хвостов после переезда на Timeweb** (`audit-legacy-tails.md`):
  живых путей данных мимо Timeweb — **0**, всё gated на `STORAGE_BACKEND=timeweb`.
  Supabase-js остался как клиент PostgREST (endpoint = Timeweb), `yc:`-ключи — текущий
  формат с роутингом в Timeweb. Мёртвое/мусор отделено от осознанного legacy.
- **feat: fail-fast барьер на `STORAGE_BACKEND`** (`instrumentation.ts` +
  `lib/config/assert-storage-backend.ts` + 8 юнит-тестов). В production при значении
  ≠ `timeweb` сервер 500-ит ВСЁ + FATAL в логе → health-check деплоя откатывает релиз.
  Выкачено `d9044ba`, **live на проде, health 200/200, 0 FATAL**. Дефолт `'supabase'`
  в `storageBackend()` НЕ менялся, dev/test не тронуты. (`experimental.instrumentationHook`.)
- **chore: гигиена** (`7a7ff2b`) — удалён мёртвый `images.remotePatterns` в
  `next.config.js` (`next/image` не используется), 5 отыгранных one-off скриптов
  переезда, `.env.example` приведён к Timeweb-реальности. Рантайм не трогает (на момент
  записи мог ещё ехать на прод — гигиена).
- **docs** (`7bf79f9`) — уточнение в `audit-legacy-tails.md` про `/api/cleanup`.
- **ci: отказоустойчивый выбор источника деплоя — primary GitFlic, fallback GitHub**
  (`afbaff8`). `select-source.sh` (`select_active_remote`: `DEPLOY_REMOTES="gitflic origin"`,
  первый ответивший на `ls-remote --exit-code` → активный; нет ни одного → честный non-zero
  провал, live не затрагивается) + `prepare-repo.sh` (ExecStartPre) + `deploy.sh` (использует
  `$ACTIVE_REMOTE` в fetch/rev-parse/archive) + `yearbook-deploy.service`. **Боевой-проверено:**
  `deploy source: gitflic (primary)` и в prepare-repo, и в deploy.sh; полный цикл build/switch
  на авто-деплое afbaff8 → `health OK`, live=afbaff8, health 200/200; отдельный прогон
  `select_active_remote` → gitflic; fallback доказан симуляцией (B2/C). Закрывает хвост v200
  про GitFlic. Откат: `yearbook-deploy.service.bak-pre-gitflic` + revert afbaff8.
- **Read-доступ сервера к GitFlic.** Добавлен remote `gitflic` (чистый URL) + **oauth2-токен
  read-only (Pull)** в credential store `/srv/yearbook/.git-credentials` (права 600, формат
  `https://oauth2:<token>@gitflic.ru`); `origin`=github не тронут. **Ротация токена** — заменить
  строку в этом файле. GitFlic из РФ стабилен (HTTP 200, ~0.4с), GitHub флапает по SSL.

### 🚩 ЧТО ДАЛЬШЕ / хвосты (НЕ горит)
- **Оживить TTL-чистку exports/delivery.** `/api/cleanup` — НЕ мёртвый код, а
  ОТКЛЮЧЁННЫЙ чистильщик истёкших `album_exports`/`delivery_files` (по `expires_at`).
  Чистит ДРУГОЕ, чем systemd `yearbook-cleanup` (тот — `photos.original_path` архивов),
  не вытеснен им. Сейчас 29 экспортов / 0 истёкших — гэп латентный. Предпочтительно:
  вынести логику в скрипт по образцу `archive-cleanup.mts` + повесить таймер.
  **НЕ удалять `/api/cleanup`.** Завести карточку в Notion.

---

## Что делали

ТЗ «адаптация макета под формат типографии (Format-модель) — превью» (19.06.2026).
Заказ хранит `format_id` (формат из `printers.config.formats[]`), но рендер брал
размеры из мастера IDML. Добавили равномерное (uniform) масштабирование дизайна
под выбранный формат заказа и показ результата в ПРЕВЬЮ и РЕДАКТОРЕ разворотов.

**Границы ТЗ:** финальный экспорт-рендер (PDF/JPG, таймаут) — отдельное ТЗ.
Растяжение (stretch) НЕ делаем. Между семействами (квадрат↔прямоугольник) НЕ
адаптируем — предупреждаем. Переключение формата «на лету» в редакторе НЕ делаем.

## Решения
- Адаптация только uniform-scale, по меньшему коэффициенту work-зоны, контент
  центрируется в целевом формате. Фон рисует холст во всю страницу (навылет).
- Адаптация только ВНУТРИ одного семейства пропорций.
- Архитектура: **адаптируем сам мастер (размеры + плейсхолдеры) ОДНИМ чистым
  преобразованием перед подачей в холст** (как layoutCover у обложки). Тогда и
  превью, и редактор подхватывают формат автоматически, координаты/кроп не ломаются.

## ✅ DONE (развороты)

### 1. Семейство дизайна `format_family`
- Миграция `migrations/2026-06-19-template-sets-format-family.sql` (nullable
  колонка, CHECK vertical_rect|square|horizontal). **Применить вручную.** Без неё
  всё работает на вычисленном семействе (обратносовместимо).
- Типы TemplateSet (lib/album-builder/types.ts + app/super/templates/_components/types.ts).
- API: TEMPLATE_SET_FIELDS отдаёт format_family; template_set_update принимает его.
- Карточка дизайна (app/super/templates): показ семейства (+ «(авто)») + модалка
  «Семейство формата» (FormatFamilyModal).

### 2. Ядро `lib/format-adapt/` (чистые функции + 10 тестов)
- `computeFormatFamily(w,h)` — по пропорции (±8% = квадрат).
- `resolveDesignFamily(set)` — явное поле или расчёт.
- `resolveFormat(config, formatId)` — формат заказа из printers.config.formats[].
- `adaptTemplateToFormat(template, source, target)` → `{status:'native'|
  'incompatible'|'adapted', template, scale, warning?}`. Масштаб по странице
  (для spread — половина ширины мастера), центрирование, скейл геометрии +
  кегля/эффектов/декора. Устойчиво к нулям work-зоны (фолбэк на размер страницы).

### 3. Превью (app/app/_components/LayoutPreviewStrip.tsx)
- Принимает `targetFormat`; адаптирует каждый мастер, рисует в пропорциях формата
  заказа; отступ корешка масштабируется; плашка-предупреждение при чужом семействе.
- Формат резолвится в AlbumDetailModal (app/app/page.tsx) через printers_list по
  album.printer_id/format_id.

### 4. Редактор разворотов (app/app/album/[id]/layout/page.tsx)
- Грузит designSource (размеры дизайна+семейство) и targetFormat (printers_list).
- Главный холст (left/right), полоса разворотов (SpreadOrderStrip) и полноэкранный
  «Вид» (LayoutPreviewFullscreen) — все на адаптированных мастерах. Отступ корешка
  масштабируется. Плашка-предупреждение при чужом семействе.
- Формат не выбран → родной формат (как было).

### Проверки: vitest 1088/1088, tsc чистый, next build зелёный.

## 🚩 ОСТАЛОСЬ В ЭТОМ ТЗ (следующий шаг)

- **ОБЛОЖКА** (превью + редактор). Это отдельная система рендера: SVG-превью
  (lib/cover/preview-svg.ts, CoverEditorBlock — aspectRatio зашит) + CoverCanvas
  (layoutCover → AlbumSpreadCanvas). Адаптация обложки требует своей математики
  масштаба: обложка = задняя+КОРЕШОК+передняя (корешок между страницами не
  масштабируется форматом, в отличие от страниц). adaptTemplateToFormat (модель
  spread=2 страницы) к обложке напрямую не подходит — нужен отдельный расчёт.
  Сделать отдельным шагом после проверки разворотов.

## Что НЕ трогали
- Engine-раскладку, страницы родителей, экспорт/таймаут — не тронуты.
- Сохранение данных/кроп — работают на оригинальных координатах (адаптация только
  для отображения).
