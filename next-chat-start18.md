Продолжаем работу над проектом. Мы строим мультиаренду для SaaS-платформы отбора фото для выпускных альбомов.

Загружаю контекст. Читай yearbook-context-v18.md — там полный статус проекта, что сделано, что дальше, все паттерны кода.

Клонируй репо (токен я приложил отдельным сообщением — НЕ коммить его никуда):

```
git clone https://odintcovsergey:<GITHUB_TOKEN>@github.com/odintcovsergey/yearbook-v2.git ~/yearbook-v2
cd ~/yearbook-v2
git config user.email "deploy@yearbook.app"
git config user.name "Deploy Bot"
git remote set-url origin https://odintcovsergey:<GITHUB_TOKEN>@github.com/odintcovsergey/yearbook-v2.git
```

Важные правила при работе:
1. Старая админка /admin работает на ADMIN_SECRET — НЕ ТРОГАТЬ пока идут заказы
2. Родительские страницы (/[token], /teacher, /ref) — НЕ ТРОГАТЬ
3. Новые файлы строим рядом: /app, /api/tenant, /super, /api/super
4. После каждого подэтапа — обновлять yearbook-context-v<N+1>.md и коммитить
5. Рабочий домен — yearbook-v2.vercel.app (album.okeybook.ru не работает без VPN)
6. НИКОГДА не вставлять токены, пароли, секреты в файлы — GitHub блокирует push

Состояние на момент этого чата:
- Фундамент мультиаренды готов (таблицы, авторизация)
- Панель superadmin /super полностью готова (создание, редактирование, блокировка, удаление арендаторов)
- Кабинет owner/manager /app готов в режиме ТОЛЬКО ЧТЕНИЕ (3.1)
- Следующий этап — 3.2.a: создание + редактирование + архивирование альбомов в /app
