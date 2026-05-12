# Sequence: upload → done

Полный sequence от пользовательского клика "Анализировать" до зелёного `optimization_score` в UI. Эта диаграмма дополняет общую — [Event-driven поток](/architecture/event-flow), — фокусируясь именно на API.

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor U as Пользователь
    participant FE as Frontend
    participant H as analysis_handler.Upload
    participant UC as AnalysisUseCase.UploadAndAnalyze
    participant RD as Redis (quota)
    participant MN as MinIO
    participant Repo as AnalysisRepository
    participant PG as PostgreSQL
    participant Prod as kafka.Producer
    participant K as Kafka

    U->>FE: Выбирает .c файл
    FE->>H: POST /upload (multipart, project_id)
    H->>H: c.GetString("user_id"), c.GetInt("analysis_quota")
    H->>UC: UploadAndAnalyze(...)
    UC->>RD: INCR quota:user:date
    RD-->>UC: used <= quota
    UC->>MN: PUT source-codes/<project>/<file>.c
    MN-->>UC: ok
    UC->>Repo: CreateFile(file)
    Repo->>PG: INSERT files
    UC->>Repo: CreateTask(task pending)
    Repo->>PG: INSERT analysis_tasks
    UC->>Repo: UpdateTaskStatus(static_running)
    Repo->>PG: UPDATE
    UC->>Prod: Publish(start_static, payload)
    Prod->>K: WriteMessages (RequireAll)
    K-->>Prod: ack
    UC-->>H: *AnalysisTask
    H-->>FE: 202 Accepted {task: {...}}

    Note over FE: Polling: каждые 2.5s GET /tasks/<id>
    FE->>H: GET /tasks/<id>
    H-->>FE: {status: static_running}

    Note over K: Kafka доставит start_static воркеру (см. [worker-static](/workers/static-analyzer/flow))

    Note over UC: Спустя секунды воркер ответит static_completed
    K->>UC: consume static_completed (consumer goroutine)
    UC->>Repo: UpdateTaskStatus(static_done)
    UC->>Repo: GetTaskByID + GetFileByID
    UC->>Repo: UpdateTaskStatus(cache_running)
    UC->>Prod: Publish(start_cache, payload)

    FE->>H: GET /tasks/<id>
    H-->>FE: {status: cache_running}

    K->>UC: consume cache_completed
    UC->>Repo: UpdateTaskStatus(done)

    FE->>H: GET /tasks/<id>
    H-->>FE: {status: done}
    FE->>H: GET /tasks/<id>/metrics
    H->>UC: GetTaskMetrics(taskID)
    UC->>PG: GetTaskByID
    UC->>UC: SELECT FROM static_patterns / dynamic_pattern_metrics
    UC-->>H: MetricsResponse
    H-->>FE: 200 {hit_rate, miss_rate, optimization_score, ...}
    FE-->>U: визуализация
```

## Polling, а не WebSocket

::: info Почему polling
- Простой реализационный путь — клиент сам контролирует интервал.
- Нет хранения долгоживущих соединений на сервере (важно для VS Code, где extension host не любит WebSocket-серверы).
- Нагрузка минимальна: одна задача даёт ~10–30 опросов до готовности (по 2.5с).

Если в будущем число одновременных задач вырастет — стоит перевести на SSE или WebSocket с push-уведомлением `task_id changed`.
:::

## Тайминги (типичный сценарий)

| Шаг | Время |
|---|---|
| Upload + INSERT + Publish | ~30–80 ms |
| Static analysis (clang AST + walker + CH insert) | ~500 ms – 5 с |
| Cache analysis (gcc + valgrind + parse + CH insert) | ~3 – 60 с |
| GetTaskMetrics (две агрегации в CH) | ~10 ms |

Cache worker обычно — bottleneck. Это нормально: cachegrind инструментирует код инструкция за инструкцией.

## Что произойдёт при ошибке на каждом шаге

| Шаг | Что упало | Эффект |
|---|---|---|
| INCR redis | redis недоступен | `500 quota check failed` |
| MinIO PUT | MinIO down | `500 minio upload` |
| INSERT files / tasks | Postgres down | `500 ...` |
| UPDATE static_running | Postgres down | task в `pending` навсегда (требует ручного rerun) |
| Producer.Publish | Kafka down | task в `static_running`, события нет |
| Consumer goroutine упала с panic | — | (сейчас просто log, без recover-а в loop) |
| Worker static error | static_completed с status=error | API переводит task в `error` |
| Worker cache error | cache_completed с status=error | task → `error` |

::: warning Идемпотентный rerun
Сейчас нет endpoint-а "перезапустить упавшую задачу". Можно сделать вручную:

1. `UPDATE analysis_tasks SET status='static_running' WHERE id=$1`
2. Дернуть `analysis-api` на `Producer.Publish(TopicStartStatic, payload)`. Сейчас публичного эндпойнта нет — только internal CLI.
:::
