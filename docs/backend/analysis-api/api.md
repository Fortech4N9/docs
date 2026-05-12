# HTTP API — Analysis API

Базовый префикс — `/api/v1/analysis`. Все эндпойнты требуют `Authorization: Bearer <token>`.

## Upload (старт пайплайна)

### `POST /upload`

::: code-group
```http [Request]
POST /api/v1/analysis/upload HTTP/1.1
Authorization: Bearer <token>
Content-Type: multipart/form-data; boundary=---X

-----X
Content-Disposition: form-data; name="project_id"

<project-uuid>
-----X
Content-Disposition: form-data; name="file"; filename="main.c"
Content-Type: text/x-csrc

<binary content>
-----X--
```

```http [202 Accepted]
HTTP/1.1 202 Accepted
{
  "message": "file uploaded, analysis started",
  "task": {
    "id": "550e84...",
    "file_id": "abc-...",
    "status": "static_running",
    "type": "full_analysis",
    "created_at": "2026-05-04T00:00:00Z",
    "updated_at": "2026-05-04T00:00:00Z"
  }
}
```

```http [400 Bad Request]
{ "error": "project_id is required" }
```

```http [429 Too Many Requests]
{ "error": "daily analysis quota exceeded" }
```
:::

::: tip Размер тела
Nginx ограничивает body до 50 MB (`client_max_body_size 50M`). Для учебных программ это огромный запас.
:::

## Чтение состояния

### `GET /tasks/:task_id`

```json
{
  "id": "550e84...",
  "file_id": "abc-...",
  "status": "static_running",
  "type": "full_analysis",
  "created_at": "...",
  "updated_at": "..."
}
```

Возможные значения `status`:

- `pending` — задача только что создана.
- `static_running` — событие `start_static` опубликовано.
- `static_done` — переходное (доли секунды).
- `cache_running` — событие `start_cache` опубликовано.
- `done` — финальный успех.
- `error` — финальная ошибка.

### `GET /tasks/:task_id/metrics`

```json
{
  "task_id": "550e84...",
  "status": "done",
  "total_memory_accesses": 4567890,
  "cache_hits": 4555545,
  "cache_misses": 12345,
  "hit_rate": 0.9973,
  "miss_rate": 0.0027,
  "optimization_score": 99.73
}
```

::: info Безопасный вызов до завершения
Если задача ещё в работе, эндпойнт вернёт `total_memory_accesses=0` + текущий статус. Это позволяет UI обновлять виджет метрик параллельно с polling-ом.
:::

::: info Источник чисел
Поля `total_memory_accesses`, `cache_hits`, `cache_misses` берутся напрямую из
`cache-out.json` (артефакт `worker-cache-interpreter`, MinIO bucket
`analysis-artifacts`). Это гарантирует совпадение с тем, что показывает сам
воркер в логах, и не зависит от потенциальных дубликатов в ClickHouse.
`optimization_score` = `0.9 * L1.hit_rate + 0.1 * L2.hit_rate`, ограниченный
сверху 100.
:::

### `GET /tasks/:task_id/aggregated`

Возвращает join `static_patterns × dynamic_pattern_metrics` для одной задачи.
Используется во вкладке «По массивам» Sandbox:

```json
[
  {
    "pattern_fingerprint": "ab12cdef",
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

::: info Reuse результата по `cache_profile_hash`
Если в `static_patterns` для этого fingerprint+`cache_profile_hash` уже есть
строка, новый запуск воркера не создаёт дубликаты — `analysis-api`
агрегирует то, что уже хранится. Подробнее в
[event-flow](/architecture/event-flow).
:::

### `GET /projects/:project_id/tasks`

```json
{
  "tasks": [
    {
      "id": "...",
      "file_id": "...",
      "status": "done",
      "type": "full_analysis",
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

Сортировка — `created_at DESC`.

## Файлы (user+)

Файл идентифицируется тройкой `(project_id, filename, sha256(content))`. При
загрузке через `POST /upload` бэкенд сначала ищет запись с этой тройкой —
если нашёл, возвращает task поверх существующего `file_id`, не дублируя
объект в MinIO и не создавая новую строку в `files`.

### `GET /projects/:project_id/files`

```json
{
  "files": [
    {
      "id": "abc-uuid",
      "project_id": "proj-uuid",
      "filename": "loop.c",
      "s3_path": "source-codes/proj-uuid/abc-uuid.c",
      "content_hash": "9f3...",
      "size_bytes": 312,
      "created_at": "2026-05-04T00:00:00Z"
    }
  ]
}
```

Сортировка — `created_at DESC`. Используется в Sandbox для левого сайдбара.

### `GET /files/:file_id/content`

Отдаёт исходник как `text/plain`. Запрашивается, когда пользователь выбирает
файл из списка, чтобы открыть его в редакторе.

### `POST /files/:file_id/analyze`

Создаёт ещё одну задачу анализа поверх уже загруженного файла, без upload-а
и без новой записи в `files`. Принимает опциональные поля `cache_profile_*`
в form-data (как и `/upload`).

```http
202 Accepted
{
  "message": "analysis started for existing file",
  "task": { ... AnalysisTask }
}
```

::: tip Когда выбирать какой эндпоинт
- В UI Sandbox: если содержимое редактора **не менялось** относительно
  загруженного файла — `POST /files/:file_id/analyze`.
- Иначе — `POST /upload`. Бэкенд сам определит, нужно ли создавать новую
  запись (в зависимости от `sha256` содержимого).
:::

## Admin (требует role=admin)

### `GET /admin/stats`

```json
{
  "total_files": 17,
  "done": 12,
  "pending": 3,
  "error": 2
}
```

### `GET /admin/patterns/top?limit=10`

```json
{
  "patterns": [
    { "pattern_type": "unit_stride",     "count": 245 },
    { "pattern_type": "non_unit_stride", "count":  87 },
    { "pattern_type": "constant",        "count":  41 },
    { "pattern_type": "gather_scatter",  "count":   9 },
    { "pattern_type": "random",          "count":   3 }
  ]
}
```

`limit` clamp-ится в [1, 100].

### `GET /admin/system-status`

```json
{
  "postgres":   { "status": "ok" },
  "minio":      { "status": "ok" },
  "kafka":      { "status": "ok" },
  "clickhouse": { "status": "ok" },
  "start_static_queue": 0
}
```

При выпадении компонента:

```json
{
  "postgres":   { "status": "down", "error": "dial tcp: i/o timeout" },
  ...
}
```

## Health

### `GET /health`

```json
{ "status": "ok", "service": "analysis-api" }
```

## Сводная таблица кодов

| Код | Когда |
|---|---|
| `202` | Upload принят (асинхронно) |
| `200` | прочее |
| `400` | bad request (нет project_id, нет file) |
| `401` | нет/невалидный токен |
| `403` | требуется admin |
| `404` | task/project не найден |
| `429` | квота на сегодня исчерпана |
| `500` | внутренняя ошибка (MinIO/PG/CH/Kafka вылетели) |
