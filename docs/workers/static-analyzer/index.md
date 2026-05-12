# Worker Static Analyzer — Overview

`worker-static-analyzer` — асинхронный воркер первого этапа пайплайна. Его задача — превратить `.c` файл в множество **паттернов доступа к памяти**.

Сам разбор делает внешний бинарь LLVM/clang-анализатора, лежащий в публичном образе [`keplar01/static-analyzer:latest`](https://hub.docker.com/r/keplar01/static-analyzer). Go-часть воркера занимается только Kafka, MinIO, ClickHouse и обвязкой над бинарём (формирование `conf.json`, чтение `out.json`).

## Место в системе

```mermaid
flowchart LR
    K1[[start_static]] --> WS[worker-static]
    WS -->|read .c| MN[(MinIO)]
    WS -->|exec analyzer conf.json| Bin[/usr/local/bin/analyzer<br/>ELF x86_64]
    Bin -->|out.json| WS
    WS -->|INSERT| CH[(ClickHouse static_patterns)]
    WS -->|PUT static-out.json| MN
    WS --> K2[[static_completed]]
```

## Что делает воркер

1. Слушает Kafka топик `events.analysis.start_static` с `GroupID=worker-static-group`.
2. Скачивает исходник из `source-codes/<project>/<file>.c` в локальный tmp.
3. Готовит `conf.json` рядом с исходником и вызывает `$ANALYZER_BINARY conf.json --quiet`.
4. Анализатор сам строит LLVM-IR, проходит по нему и для каждого паттерна доступа выдаёт строку в `out.json` (см. [Контракт бинаря](./binary-contract)).
5. Воркер читает `out.json` как `[]model.Pattern` и пишет батчем в `analysis_metrics.static_patterns`.
6. Сохраняет тот же `out.json` в bucket `analysis-artifacts` под именем `<task_id>/static-out.json`.
7. Публикует `events.analysis.static_completed` со статусом `success` или `error`.

::: tip Чёрный ящик с фиксированным контрактом
`internal/analyzer/analyzer.go` ничего не знает про реализацию: пишет JSON-конфиг, дёргает бинарь, читает JSON-результат. Любой бинарь, реализующий тот же контракт `conf.json → out.json`, подходит. Подробности — на странице [Контракт бинаря](./binary-contract).
:::

## Что является входом и выходом

**Вход** (Kafka payload):

```json
{
  "task_id": "550e84...",
  "project_id": "11111-...",
  "file_s3_path": "source-codes/proj/file.c",
  "cache_profile_hash": "L1=32K_8w_64B|L2=256K_8w_64B|L3=8M_16w_64B"
}
```

**Выходы**:

- ClickHouse — строки в `analysis_metrics.static_patterns` (по одной на каждый паттерн доступа).
- MinIO — `analysis-artifacts/<task_id>/static-out.json` (тот же JSON, что вернул бинарь).
- Kafka — `events.analysis.static_completed` с `artifact_s3_path` или `error`.

## Дальше

- [Стек и конфигурация](./config) — env, Dockerfile, образ-база.
- [Структура кода](./architecture) — layout пакетов и пайплайн одной задачи.
- [Контракт бинаря](./binary-contract) — `conf.json`, `out.json`, поля `Pattern`.
- [Sequence](./flow) — happy path и failure paths.
