-- Реферальные программы — Этап 1: bucket для двух картинок программы.
--
-- Каждая программа несёт ДВЕ разные картинки (ТЗ docs/tz-referral-programs.md):
--   referrer_image_url — мотивирует делиться (на странице «Спасибо»);
--   invitee_image_url  — мотивирует заказать (на лендинге).
--
-- Структура пути: <program_id>/<side>/<uuid>.<jpg|png>
--   где side = 'referrer' | 'invitee'.
--
-- Public bucket → читается по прямой ссылке без токена (как фоны/декор/фото).
-- Запись идёт серверным service_role key через подписанные upload-URL
-- (двухшаговый sign/commit, обход лимита тела Vercel ~4.5 МБ) — политики
-- на INSERT/UPDATE/DELETE не нужны.
--
-- Откат: delete from storage.buckets where id = 'referral-images';
--   (только если bucket пуст; иначе сначала удалить объекты).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'referral-images',
  'referral-images',
  true,
  10485760,                              -- 10 MB (маркетинговые картинки)
  array['image/jpeg', 'image/png']
)
on conflict (id) do nothing;

-- Проверка после миграции:
-- SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'referral-images';
-- (одна строка, public = true)
