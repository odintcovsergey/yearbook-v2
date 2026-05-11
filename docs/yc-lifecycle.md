# Yandex Cloud Object Storage — настройка lifecycle policy

**Дата:** 11.05.2026 (фаза В.3)
**Контекст:** [docs/roadmap-after-phase-3.md](./roadmap-after-phase-3.md) раздел В

## Зачем

После закрытия фазы Б (оригиналы для печати) хранилище YC начнёт расти на 5-10 МБ × N фото на каждый альбом. Без автоматического удаления старых файлов через несколько месяцев счёт от YC превысит бюджет.

Lifecycle policy в YC позволяет автоматически:
- Удалять файлы после определённого возраста (`exports/` через 90 дней, `delivery/` через 180 дней)
- Переводить в Cold storage (дешевле в 3 раза) старые оригиналы завершённых альбомов

Lifecycle policy настраивается **в самом YC через консоль или CLI**, не в нашем коде. Наш cleanup endpoint (`/api/cleanup`) синхронизирует БД с тем что YC удалил физически.

---

## Что настраивать

### Правило 1: exports/ → удаление через 90 дней

Применяется к: все объекты с префиксом, содержащим `/exports/`
Действие: удалить через 90 дней после создания

Это PDF-экспорты — после 90 дней партнёр почти наверняка их уже скачал. Если нужно — пересоберёт.

### Правило 2: delivery/ → удаление через 180 дней (6 месяцев)

Применяется к: все объекты с префиксом, содержащим `/delivery/`
Действие: удалить через 180 дней после создания

Это готовые файлы которые OkeyBook передаёт фотографам. 6 месяцев — достаточный срок чтобы скачать.

### Правило 3 (опционально): originals/ → Cold storage через 60 дней

Применяется к: все объекты с префиксом, содержащим `/originals/`
Действие: перейти в класс хранения `COLD` через 60 дней после создания

**Внимание:** это правило затронет ВСЕ оригиналы — и завершённых, и активных альбомов. Активные альбомы по сезону завершаются за 1-3 месяца, так что 60 дней — разумный компромисс. Если фотограф будет редактировать альбом старше 60 дней — извлечение из Cold добавит ~1 час задержки на каждый файл.

Альтернатива: пропустить это правило, держать всё в Standard. Текущая нагрузка не критична.

---

## Как настроить через консоль YC

1. Открыть [YC Console](https://console.cloud.yandex.ru/)
2. Перейти в Object Storage → bucket `yearbook-photos`
3. Вкладка «Жизненный цикл» → «Создать правило»

### Правило для exports/

- Имя: `expire-exports-90d`
- Префикс: оставить пустым (правило применится ко всем объектам, но фильтр по префиксу через теги или path filter)
- Действие: «Удалить объект»
- Через: 90 дней после создания

К сожалению YC консоль не поддерживает path-based фильтры в UI (только тэги). Если в консоли нельзя задать фильтр по `/exports/` — придётся либо через CLI (см. ниже), либо тэгировать объекты при загрузке (потребует доработки кода).

### Через YC CLI (рекомендуется)

Используя [aws-cli с YC endpoint](https://yandex.cloud/ru/docs/storage/tools/aws-cli):

```bash
# Установить aws-cli если ещё нет
brew install awscli  # macOS

# Настроить (один раз) credentials YC
aws configure --profile yc-yearbook
# AWS Access Key ID: <YC_ACCESS_KEY_ID>
# AWS Secret Access Key: <YC_SECRET_ACCESS_KEY>
# Default region: ru-central1
# Default output format: json
```

Файл `lifecycle.json` (положи рядом, например в `~/yc-lifecycle.json`):

```json
{
  "Rules": [
    {
      "ID": "expire-exports-90d",
      "Status": "Enabled",
      "Filter": {
        "Prefix": ""
      },
      "Expiration": {
        "Days": 90
      },
      "NoncurrentVersionExpiration": {
        "NoncurrentDays": 1
      },
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 1
      }
    }
  ]
}
```

**ВАЖНО:** Пример выше — это правило для ВСЕГО bucket'а (Prefix: ""). YC S3 API не поддерживает регулярки в Prefix. Чтобы применять разные правила к `exports/`, `delivery/`, `originals/` — нужно или:

**Вариант A — Path-based prefix.** Но наши пути `<album_id>/exports/...` не подходят для prefix filter — он работает с начала ключа. Альбом-ID впереди.

**Вариант B — Object tags.** Доработать `ycUpload` чтобы при заливке в `exports/` ставить tag `category=exports`. Тогда lifecycle rule с TagFilter сработает. Это +1 час кода, отдельной задачей.

**Вариант C — Прагматичный: один общий 90d expire для всего, кроме originals.** Перепутать порядок папок: вместо `<album_id>/exports/` использовать `exports/<album_id>/`. Это **большое изменение** в архитектуре путей, тоже отдельная задача.

### Что делать прямо сейчас

В рамках фазы В.3 — **просто фиксируем что lifecycle через консоль YC настроить ПОКА НЕЛЬЗЯ** из-за нашей структуры путей. Lifecycle policy откладывается до доработки кода (теги объектов).

**Реалистичная стратегия:**

1. **Текущий cleanup** через `/api/cleanup` endpoint работает и без lifecycle. Это можно запускать вручную раз в неделю или подключить к cron-планировщику (UptimeRobot, GitHub Actions).
2. **Виджет YC Storage** в `/super` показывает текущий размер — отслеживаем тренд.
3. **Когда хранилище реально превысит ~50 ГБ** — возвращаемся к этой задаче и:
   - Либо реструктурируем пути (вариант C)
   - Либо добавляем object tags (вариант B)
   - Либо настраиваем правила в YC консоли (если YC к тому моменту поддержит regex prefix)

---

## Команды для applying правила (когда будет готов фильтр)

```bash
# Применить
aws s3api put-bucket-lifecycle-configuration \
  --bucket yearbook-photos \
  --lifecycle-configuration file://lifecycle.json \
  --endpoint-url=https://storage.yandexcloud.net \
  --profile yc-yearbook

# Проверить применённое правило
aws s3api get-bucket-lifecycle-configuration \
  --bucket yearbook-photos \
  --endpoint-url=https://storage.yandexcloud.net \
  --profile yc-yearbook

# Удалить (если что)
aws s3api delete-bucket-lifecycle \
  --bucket yearbook-photos \
  --endpoint-url=https://storage.yandexcloud.net \
  --profile yc-yearbook
```

---

## Что точно делать прямо сейчас (action items для Сергея)

1. **Добавить `CLEANUP_SECRET` в Vercel env переменные.** Любая случайная строка, например:
   ```
   openssl rand -hex 32
   ```
   Это нужно для `/api/cleanup` endpoint (фаза В.1).

2. **Запустить cleanup вручную после деплоя:**
   ```
   curl -X POST -H "Authorization: Bearer <CLEANUP_SECRET>" \
     "https://yearbook-v2.vercel.app/api/cleanup?dry_run=1"
   ```
   `dry_run=1` покажет что было бы удалено, без реального удаления. Можно убедиться что endpoint работает.

3. **Открыть `/super`, кликнуть «Обновить статистику YC».** Виджет покажет текущий размер хранилища. По итогам фаз А+Б ожидание ~600 МБ → 1-2 ГБ. После сезона можем превысить 50 ГБ — тогда возвращаемся к lifecycle policy.

4. **(Опционально) подключить /api/cleanup к cron-планировщику.** Варианты:
   - UptimeRobot: бесплатно, проверяет URL каждые 5 минут. Создать монитор для `/api/cleanup` с POST и Authorization header. Срабатывание раз в день/неделю.
   - GitHub Actions: добавить workflow с `schedule: cron: '0 3 * * 0'` (каждое воскресенье 3 утра).
   - Vercel Cron: требует Pro план ($20/мес).

---

## История документа

- 11.05.2026 — создан в рамках фазы В.3. Зафиксировано что lifecycle policy через YC консоль ПОКА НЕЛЬЗЯ настроить из-за структуры путей `<album_id>/category/...` — prefix filter не работает с регексами. Требуется либо доработка путей, либо object tags. Откладывается до момента когда хранилище реально вырастет.
