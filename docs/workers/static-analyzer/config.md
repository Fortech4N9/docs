# Стек и конфигурация — Worker Static

## Технологический стек

| Категория | Технология |
|---|---|
| Язык | Go 1.22 |
| Kafka | `segmentio/kafka-go` |
| MinIO | `minio-go/v7` |
| ClickHouse | `clickhouse-go/v2` |
| Анализатор | `keplar01/static-analyzer:latest` (публичный образ; внутри — ELF x86_64 `/usr/local/bin/analyzer`) |

## Переменные окружения

| Переменная | Дефолт | Назначение |
|---|---|---|
| `KAFKA_BROKERS` | `localhost:9092` | Kafka bootstrap |
| `MINIO_ENDPOINT` | `localhost:9000` | MinIO API |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO access |
| `MINIO_SECRET_KEY` | `minioadmin123` | MinIO secret |
| `CLICKHOUSE_ADDR` | `localhost:9000` | ClickHouse native |
| `CLICKHOUSE_USER` | `default` | ClickHouse user |
| `CLICKHOUSE_PASSWORD` | `clickhouse_secret` | ClickHouse password |
| `CLICKHOUSE_DB` | `analysis_metrics` | DB |
| `ANALYZER_BINARY` | `/usr/local/bin/analyzer` | путь до исполняемого файла-анализатора внутри контейнера |

## Контейнер

```dockerfile
# Stage 1: Go-builder.
FROM --platform=linux/amd64 golang:1.22-alpine AS go-builder
WORKDIR /app
COPY worker-static-analyzer/go.mod worker-static-analyzer/go.sum ./
RUN go mod download
COPY worker-static-analyzer/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /worker-static ./cmd

# Stage 2: runtime — публичный образ с готовым бинарём анализатора.
FROM --platform=linux/amd64 keplar01/static-analyzer:latest
COPY --from=go-builder /worker-static /usr/local/bin/worker-static
WORKDIR /app
ENTRYPOINT []
CMD ["worker-static"]
```

База `keplar01/static-analyzer:latest` уже содержит:

- `/usr/local/bin/analyzer` — сам анализатор (ELF x86_64).
- весь его рантайм (необходимые `clang/llvm` библиотеки).

Поэтому Stage-2 минимален — копируется только Go-бинарь воркера.

## Compose

```yaml
worker-static:
  build:
    context: ..
    dockerfile: worker-static-analyzer/Dockerfile
  image: diploma-fix-worker-static:latest
  platform: linux/amd64
  environment:
    KAFKA_BROKERS: kafka:29092
    MINIO_ENDPOINT: minio:9000
    MINIO_ACCESS_KEY: ${MINIO_ROOT_USER}
    MINIO_SECRET_KEY: ${MINIO_ROOT_PASSWORD}
    CLICKHOUSE_ADDR: clickhouse:9000
    CLICKHOUSE_USER: ${CLICKHOUSE_USER}
    CLICKHOUSE_PASSWORD: ${CLICKHOUSE_PASSWORD}
    CLICKHOUSE_DB: ${CLICKHOUSE_DB}
```

## Retry на старте — ClickHouse

```go
for i := range 30 {
    conn, err = clickhouse.Open(...)
    if err == nil && conn.Ping(ctx) == nil { return conn, nil }
    time.Sleep(2 * time.Second)
}
```

30 × 2с = 60 секунд ожидания CH перед `log.Fatalf`.

## Команды разработки

```bash
# Локальная сборка воркера
cd worker-static-analyzer
go build -o ./bin/worker-static ./cmd

# Запуск (нужен поднятый стек: kafka, minio, clickhouse, и сам анализатор)
ANALYZER_BINARY=/path/to/analyzer ./bin/worker-static
```

В Docker всё уже на месте — достаточно `make up`.
