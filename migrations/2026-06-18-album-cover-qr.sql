-- QR-код для задней обложки (ТЗ tz-cover-editor, правка Сергея): партнёр
-- загружает картинку QR в заказе, она встаёт в слот back_qr обложки.
-- Путь картинки в публичном bucket photos (как логотип).
--
-- Аддитивно/безопасно. Откат: alter table albums drop column if exists cover_qr_url;

alter table albums
  add column if not exists cover_qr_url text;

-- Проверка: \d albums → есть cover_qr_url (text)
