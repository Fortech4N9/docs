# HTTP API Reference

Сводный справочник всех HTTP-маршрутов платформы. Каждый сервис подробнее описан на своей странице (`backend/core-api/api`, `backend/analysis-api/api`).

## Базовый префикс и авторизация

| Сервис | Префикс | Auth |
|---|---|---|
| core-api | `/api/v1/auth`, `/api/v1/projects`, `/api/v1/admin` | JWT (кроме `/auth/*`) |
| analysis-api | `/api/v1/analysis` | JWT (все маршруты) |

Заголовок: `Authorization: Bearer <jwt>`. Дополнительно тем же значением выставляется **HttpOnly** cookie `diplom_access_token` (имя задаётся `AUTH_COOKIE_NAME`) при успешном `login` / `register` и при `impersonate`, чтобы веб‑клиент мог ходить в API с cookie и чтобы при необходимости nginx **`auth_request`** видел токен без Bearer на каждом запросе. Сессию сбрасывает `POST /auth/logout`.

Формат — HS256, payload описан в [JWT и middleware](/backend/core-api/auth).

::: warning Internal
`GET /api/v1/internal/docs-gate` — внутренний эндпойнт для subrequest **`auth_request`** nginx, если доки снова повесят за gateway; ответ **200** с заголовком `X-Docs-Auth: ok|anon|forbidden`. Не используйте как публичный контракт клиентов.
:::

## Core API

### Auth (public)

| Метод | Путь | Body | Ответ |
|---|---|---|---|
| `POST` | `/auth/register` | `{email, password}` | `{token, user}` + Set-Cookie |
| `POST` | `/auth/login` | `{email, password}` | `{token, user}` + Set-Cookie |
| `POST` | `/auth/logout` | — | `{message}` + очистка cookie |

### Projects (user+)

| Метод | Путь | Body | Ответ |
|---|---|---|---|
| `GET` | `/projects` | — | `Project[]` |
| `POST` | `/projects` | `{name}` | `Project` |
| `DELETE` | `/projects/:id` | — | `204` |

### Admin (admin only)

| Метод | Путь | Query/Body | Ответ |
|---|---|---|---|
| `GET` | `/admin/users` | `?page=&limit=` | `{users[], pagination}` |
| `PATCH` | `/admin/users/:id/quota` | `{analysis_quota}` | `{message}` |
| `PATCH` | `/admin/users/:id/active` | `{is_active}` | `{message}` |
| `POST` | `/admin/users/:id/impersonate` | — | `{token}` |
| `GET` | `/admin/projects` | `?page=&limit=` | `{projects[], pagination}` |
| `GET` | `/admin/stats` | — | `{total_users, active_users, admins, total_projects}` |

### Health

| Метод | Путь | Ответ |
|---|---|---|
| `GET` | `/health` | `{status:"ok", service:"core-api"}` |

## Analysis API

### Tasks (user+)

| Метод | Путь | Body | Ответ |
|---|---|---|---|
| `POST` | `/analysis/upload` | multipart `project_id`, `file`, **`cache_config_id` (обязательно)**, опционально параметры `cache_profile_*` | `202 {message, task}` |
| `GET` | `/analysis/cache-configs` | — | `{configs: CacheSimulatorConfig[]}` |
| `POST` | `/analysis/cache-configs` | multipart `file`, опционально `name` | `201 {config}` |
| `DELETE` | `/analysis/cache-configs/:config_id` | — | `204` |
| `GET` | `/analysis/tasks/:task_id` | — | `AnalysisTask` |
| `GET` | `/analysis/tasks/:task_id/metrics` | — | `MetricsResponse` (из **`cache-out.json`**, см. [метрики](/backend/analysis-api/metrics)) |
| `GET` | `/analysis/tasks/:task_id/aggregated` | — | `{ task_id, status, patterns: AggregatedEntry[] }` |
| `GET` | `/analysis/tasks/:task_id/static-patterns` | — | `{ task_id, status, patterns }` только из **static_patterns** |
| `GET` | `/analysis/projects/:project_id/tasks` | — | `{tasks[]}` |

### Конфиги симулятора кэша (`cache_simulator_configs`)

Пользователь загружает **JSON-конфиги** (расширение `.json`, валидный JSON) для будущей интеграции в cache-analysis-worker. Файлы попадают в **MinIO** (bucket `source-codes`, ключи `cache-configs/<user_id>/<uuid>.json`) и привязаны к `user_id` из JWT analysis-api.

| Правило | Значение |
|---|---|
| Квота | не более **10** конфигов на аккаунт для роли `user`; роль **`admin`** без лимита |
| Формат | только **`.json`**, содержимое — валидный JSON |
| Размер | до **256 KiB** |

Путь к выбранному конфигу копируется в `analysis_tasks.cache_config_s3_path` и уходит в событии **`events.analysis.start_cache`** полем `cache_config_s3_path`.

### Files (user+)

Файл — это пара `(project_id, filename, sha256(content))`. Запись в `files` и
объект в MinIO создаются ровно один раз; повторная отправка того же содержимого
переиспользует существующую запись.

| Метод | Путь | Body | Ответ |
|---|---|---|---|
| `GET` | `/analysis/projects/:project_id/files` | — | `{files: ProjectFile[]}` |
| `GET` | `/analysis/files/:file_id/content` | — | `text/plain` (исходник) |
| `DELETE` | `/analysis/files/:file_id` | — | `204` (soft-delete — строка помечена `deleted_at`, MinIO не трогаем) |
| `POST` | `/analysis/files/:file_id/analyze` | multipart **`cache_config_id` (обязательно)**, опционально `cache_profile_*` | `202 {message, task}` |

::: tip Дедупликация и повторный анализ
- `POST /upload` с тем же `(project_id, filename)` и тем же содержимым **не
  создаёт** новую запись в `files` и не загружает объект в MinIO повторно —
  возвращается task с уже существующим `file_id`.
- `POST /files/:file_id/analyze` стартует ещё одну задачу анализа поверх уже
  загруженного файла без upload-а — это путь «Анализировать ещё раз» в Sandbox.
:::

### Admin (admin only)

| Метод | Путь | Query | Ответ |
|---|---|---|---|
| `GET` | `/analysis/admin/stats` | — | `AnalysisAdminStats` |
| `GET` | `/analysis/admin/patterns/top` | `?limit=10` | `{patterns: TopPattern[]}` |
| `GET` | `/analysis/admin/system-status` | — | `SystemStatus` |

### Health

| Метод | Путь | Ответ |
|---|---|---|
| `GET` | `/health` | `{status:"ok", service:"analysis-api"}` |

## Полные схемы ответов

### `User`

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "role": "user|admin",
  "analysis_quota": 10,
  "is_active": true,
  "created_at": "2026-05-04T00:00:00Z"
}
```

### `Project`

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "name": "MyProject",
  "created_at": "2026-05-04T00:00:00Z"
}
```

### `ProjectFile`

```json
{
  "id": "uuid",
  "project_id": "uuid",
  "filename": "loop.c",
  "s3_path": "source-codes/<project_id>/<file_id>.c",
  "content_hash": "sha256-hex",
  "size_bytes": 312,
  "created_at": "2026-05-04T00:00:00Z"
}
```

### `AnalysisTask`

```json
{
  "id": "uuid",
  "file_id": "uuid",
  "status": "pending|static_running|static_done|cache_running|done|error",
  "type": "full_analysis",
  "cache_config_id": "uuid",
  "cache_config_s3_path": "source-codes/cache-configs/<user>/<id>.json",
  "created_at": "...",
  "updated_at": "..."
}
```

### `CacheSimulatorConfig`

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "display_name": "my-machine",
  "original_filename": "cache.json",
  "s3_path": "source-codes/cache-configs/<user>/<id>.json",
  "size_bytes": 1234,
  "created_at": "2026-05-04T00:00:00Z"
}
```

### `MetricsResponse`

Считается на лету из `cache-out.json` (артефакт `worker-cache-interpreter`).
Берётся `summary.l1` как доминирующий уровень, score = `0.9 * L1.hit_rate + 0.1 * L2.hit_rate`.

```json
{
  "task_id": "uuid",
  "status": "done",
  "total_memory_accesses": 4567890,
  "cache_hits": 4555545,
  "cache_misses": 12345,
  "hit_rate": 0.9973,
  "miss_rate": 0.0027,
  "optimization_score": 99.73
}
```

### `AggregatedMetrics`

Join `static_patterns` и `dynamic_pattern_metrics` в ClickHouse по
`pattern_fingerprint + base_symbol + access_kind + cache_profile_hash`.
Используется в Sandbox-вкладке «По массивам».

```json
[
  {
    "pattern_fingerprint": "ab12...",
    "base_symbol": "A",
    "access_kind": "load",
    "cache_profile_hash": "default-l1l2",
    "source_file": "loop.c",
    "source_line": 42,
    "pattern_type": "unit_stride",
    "stride": 1,
    "depth": 2,
    "load_count": 1024,
    "store_count": 0,
    "l1_misses": 16,
    "l2_misses": 1
  }
]
```

### `SystemStatus`

```json
{
  "postgres":   { "status": "ok|down", "error": "..." },
  "minio":      { "status": "ok|down", "error": "..." },
  "kafka":      { "status": "ok|down", "error": "..." },
  "clickhouse": { "status": "ok|down", "error": "..." },
  "start_static_queue": 0
}
```

### `TopPattern`

```json
{ "pattern_type": "unit_stride", "count": 245 }
```

### `AnalysisAdminStats`

```json
{ "total_files": 17, "done": 12, "pending": 3, "error": 2 }
```

## Сводная таблица кодов

| Код | Означает | Где встречается |
|---|---|---|
| `200` | успех | большинство GET |
| `201` | created | `POST /projects` |
| `202` | accepted (асинхронно) | `POST /analysis/upload` |
| `400` | bad request | валидация payload не прошла |
| `401` | unauthorized | нет/невалид JWT, account disabled, неверный пароль |
| `403` | forbidden | требуется admin |
| `404` | not found | task/project/user не найден |
| `409` | conflict | дубликат email при регистрации |
| `429` | too many requests | дневная квота анализов исчерпана |
| `500` | internal error | хранилище недоступно |

## Маршрутизация в nginx

```nginx
location /api/v1/auth        { proxy_pass http://core_api; }
location /api/v1/projects    { proxy_pass http://core_api; }
location /api/v1/admin       { proxy_pass http://core_api; }
location /api/v1/analysis    { proxy_pass http://analysis_api; }
location /                   { proxy_pass http://frontend; }
```

::: tip Один origin для всего
И UI, и API живут на `http://localhost`. Браузер не делает CORS-preflight, JWT прозрачно отправляется в каждом запросе.
:::

## Примеры curl-запросов

> Nginx слушает `${NGINX_PORT}` (по умолчанию `8080`). Замените
> `http://localhost:8080` на свой `NGINX_PORT`, если переопределили его в `.env`.

```bash
# Регистрация
curl -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"u@e.com","password":"secret"}'

# Логин
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"u@e.com","password":"secret"}' | jq -r .token)

# Создать проект
curl -X POST http://localhost:8080/api/v1/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"MyProject"}'

# Загрузить .c файл
curl -X POST http://localhost:8080/api/v1/analysis/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "project_id=<uuid>" \
  -F "file=@./main.c"

# Метрики
curl http://localhost:8080/api/v1/analysis/tasks/<task_id>/metrics \
  -H "Authorization: Bearer $TOKEN"
```
