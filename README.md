# crmchat

## Поднять после перезагрузки компьютера

```bash
cd ~/crmchat
docker compose up -d --wait    # postgres
pnpm dev                        # api:3000 + web:5173 (turbo)
```

Если БД пустая (wipe volume / первый запуск) — вместо первой пары:

```bash
pnpm setup                      # docker up + db:push + db:seed
pnpm dev
```

Telegram-клиент живёт внутри API-процесса (`apps/api`), отдельного запуска не требует — поднимется вместе с `pnpm dev`. Сессии TG-аккаунтов хранятся в БД (`outreach_accounts`), переавторизация после рестарта не нужна.
