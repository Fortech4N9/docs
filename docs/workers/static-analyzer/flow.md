# Sequence — Worker Static

## Обработка одной задачи

```mermaid
sequenceDiagram
    autonumber
    participant K as Kafka start_static
    participant W as worker-static
    participant MN as MinIO
    participant Bin as /usr/local/bin/analyzer
    participant CH as ClickHouse
    participant K2 as Kafka static_completed

    K->>W: ReadMessage(start_static)
    W->>W: json.Unmarshal → StartEvent
    W->>W: os.MkdirTemp("/tmp/static-analysis-*")
    W->>MN: GET source-codes/<project>/<file>.c
    MN-->>W: localPath workDir/<file>.c
    W->>W: write workDir/conf.json
    W->>Bin: exec analyzer conf.json --quiet (cwd=workDir)
    Bin-->>W: workDir/out.json
    W->>W: json.Unmarshal(out.json) → []Pattern
    W->>CH: INSERT batch INTO static_patterns
    CH-->>W: ok
    W->>MN: PUT analysis-artifacts/<task>/static-out.json
    MN-->>W: ok
    W->>K2: produce static_completed{status:success, artifact_s3_path}
```

## Failure-paths

```mermaid
sequenceDiagram
    autonumber
    participant W as worker-static
    participant K as Kafka

    W->>W: MinIO.DownloadSource fail
    W->>K: produce static_completed{status:error, error:"download source: ..."}

    W->>W: analyzer.Run fail (non-zero exit или нет out.json)
    W->>K: produce static_completed{status:error, error:"run analyzer: ..."}

    W->>W: json.Unmarshal(out.json) fail
    W->>K: produce static_completed{status:error, error:"parse out.json: ..."}

    W->>W: ClickHouse batch fail (логируется, не блокирует)
    W->>K: produce static_completed{status:success}

    W->>W: MinIO.UploadArtifact fail
    W->>K: produce static_completed{status:error, error:"upload artifact: ..."}
```

::: tip Гарантия отправки события
Любая ветка в `AnalysisUseCase.process` рано или поздно вызывает `sendCompleted`. Это значит, что для каждой полученной задачи **гарантированно публикуется ровно одно `static_completed`** — либо `success`, либо `error`.
:::

::: warning ClickHouse не блокирует завершение
Если запись в `static_patterns` упала, воркер только логирует ошибку и всё равно публикует `success`, потому что артефакт `static-out.json` уже лежит в MinIO и доступен фронту. Это сознательный trade-off в пользу частичной доступности результатов.
:::

## Что лежит в артефакте

`static-out.json` — ровно тот массив, который выдал анализатор (формат — на странице [Контракт бинаря](./binary-contract)). Воркер не модифицирует выход.

```json
[
  {
    "access_kind": "load",
    "base_symbol": "A",
    "function": "matmul",
    "pattern_type": "multidim_affine",
    "source_file": "main.c",
    "source_line": 12,
    "stride": 1,
    "depth": 3,
    "fill_factor": 1,
    "...": "..."
  }
]
```
