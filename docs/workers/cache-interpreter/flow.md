# Sequence — Worker Cache

## Обработка одной задачи (happy path)

```mermaid
sequenceDiagram
    autonumber
    participant K as Kafka start_cache
    participant W as worker-cache
    participant MN as MinIO
    participant CS as wine CacheSim.exe
    participant K2 as Kafka cache_completed

    K->>W: ReadMessage(start_cache)
    W->>W: json.Unmarshal → StartEvent
    W->>W: os.MkdirTemp("/tmp/cache-interp-*")
    W->>MN: GET source-codes/<project>/<file>.c
    MN-->>W: workDir/<file>.c
    W->>CS: exec wine CacheSim.exe <file>.c (cwd=workDir)
    CS-->>W: stdout (Cache L1/L2/Memory)
    W->>W: parseOutput(stdout) → CacheSimResult
    W->>W: json.MarshalIndent(result)
    W->>MN: PUT analysis-artifacts/<task>/cache-out.json
    MN-->>W: ok
    W->>K2: produce cache_completed{status:success, artifact_s3_path}
```

После `cache_completed` сценарий продолжается уже на стороне `analysis-api-service` — он скачивает `cache-out.json`, JOIN-ит с `static_patterns` и пишет `dynamic_pattern_metrics`.

## Failure-paths

```mermaid
sequenceDiagram
    autonumber
    participant W as worker-cache
    participant MN as MinIO
    participant K as Kafka

    W->>MN: GET source.c → fail
    W->>K: produce cache_completed{status:error, error:"download source: ..."}

    W->>W: wine CacheSim.exe → non-zero exit
    W->>K: produce cache_completed{status:error, error:"cachesim run: ..."}

    W->>W: parseOutput → no L1 block
    W->>K: produce cache_completed{status:error, error:"parse cachesim output: ..."}

    W->>W: json.Marshal → unsupported NaN
    W->>K: produce cache_completed{status:error, error:"marshal cache result: ..."}

    W->>MN: PUT cache-out.json → fail
    W->>K: produce cache_completed{status:error, error:"upload artifact: ..."}
```

::: tip Гарантия отправки события
Любая ветка в `CacheUseCase.HandleStartEvent` рано или поздно вызывает `sendCompleted`. Это значит, что для каждой полученной задачи **гарантированно публикуется ровно одно `cache_completed`** — либо `success`, либо `error`.
:::

## Что лежит в `cache-out.json`

```json
{
  "source_file": "main.c",
  "sim_time_sec": 1.44955,
  "l1": {
    "cache_level": "L1",
    "cache_size_kb": 32,
    "cache_line_size": 64,
    "associativity": 8,
    "total_accesses": 4003000,
    "total_hits": 4002812,
    "total_misses": 188,
    "hits_read": 3000000,
    "hits_write": 1002812,
    "misses_read": 0,
    "misses_write": 188,
    "miss_rate": 0.00469648
  },
  "l2": {
    "cache_level": "L2",
    "cache_size_kb": 256,
    "cache_line_size": 64,
    "associativity": 8,
    "total_accesses": 188,
    "total_hits": 0,
    "total_misses": 188,
    "miss_rate": 1
  },
  "arrays": [
    {"cache_level": "L1", "array_name": "a", "misses_total": 62, "misses_read": 0, "misses_write": 62},
    {"cache_level": "L1", "array_name": "b", "misses_total": 63, "misses_read": 0, "misses_write": 63},
    {"cache_level": "L2", "array_name": "a", "misses_total": 62, "misses_read": 0, "misses_write": 62}
  ],
  "memory_reads": 188,
  "memory_writes": 188
}
```

## Тайминги

| Шаг | Время |
|---|---|
| Download .c | <100 ms |
| `wine CacheSim.exe <file>` | от долей секунды до десятков секунд (зависит от итераций цикла) |
| Parse stdout | <10 ms |
| MinIO PUT | <50 ms |
| Kafka publish | <50 ms |

`CacheSim.exe` — основной bottleneck. Под Lima x86_64 VM на Apple Silicon ещё добавляется QEMU-эмуляция, что даёт замедление в несколько раз против нативного x86_64.

## После `cache_completed`

`analysis-api-service` принимает событие через `Consumer.handleCacheCompleted`:

- Если `status == "success"` — скачивает `cache-out.json`, делает JOIN с `static_patterns` по `(source_file, base_symbol == array_name)` и вставляет в `dynamic_pattern_metrics`. Затем переводит задачу в `done`.
- Если `status == "error"` — переводит задачу в `error`, сохраняет `error_message`.

Дальше фронт видит финальный статус и делает `GET /tasks/<id>/metrics`, который агрегирует обе таблицы.
