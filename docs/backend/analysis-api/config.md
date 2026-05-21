# Стек и конфигурация — Analysis API

## Технологический стек

| Категория | Технология | Версия |
|---|---|---|
| Язык | Go | 1.24 |
| HTTP framework | Gin | latest |
| OLTP БД | PostgreSQL | 16 |
| OLAP БД | ClickHouse | 24 (`clickhouse-go/v2`) |
| Кэш / квоты | Redis | 7 (`go-redis/v9`) |
| Object storage | MinIO | latest (`minio-go/v7`) |
| События | Kafka | Confluent 7.6 (`segmentio/kafka-go`) |
| JWT | `golang-jwt/jwt/v5` | v5 |

## Переменные окружения

| Переменная | Дефолт | Назначение |
|---|---|---|
| `SERVER_PORT` | `8082` | Порт HTTP-сервера |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USER` | `diplom` | PostgreSQL user |
| `DB_PASSWORD` | `diplom_secret` | PostgreSQL password |
| `DB_NAME` | `analysis_db` | Имя БД (отдельная от `core_db`!) |
| `JWT_SECRET` | `super-secret-jwt-key-for-diploma-2026` | **Тот же, что и в core-api** |
| `AUTH_COOKIE_NAME` | `diplom_access_token` | То же имя HttpOnly cookie — fallback, если запрос пришёл только с cookie (см. core-api `JWTAuth`) |
| `MINIO_ENDPOINT` | `localhost:9000` | MinIO API endpoint |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO access |
| `MINIO_SECRET_KEY` | `minioadmin123` | MinIO secret |
| `MINIO_USE_SSL` | `false` | TLS до MinIO |
| `KAFKA_BROKERS` | `localhost:9092` | Kafka bootstrap |
| `REDIS_ADDR` | `localhost:6379` | Redis для квот |
| `REDIS_PASSWORD` | `redis_secret` | Redis password |
| `CLICKHOUSE_ADDR` | `localhost:9000` | ClickHouse native protocol |
| `CLICKHOUSE_USER` | `default` | ClickHouse user |
| `CLICKHOUSE_PASSWORD` | `clickhouse_secret` | ClickHouse password |
| `CLICKHOUSE_DB` | `analysis_metrics` | ClickHouse database |

::: warning Всё пробрасывает docker-compose
В `infra/docker-compose.yml` сервис `analysis-api` получает корректные значения автоматически (`KAFKA_BROKERS=kafka:29092`, `CLICKHOUSE_ADDR=clickhouse:9000`, …). Локальные дефолты подходят только для запуска "go run" с локально стоящим стеком.
:::

## Зависимости старта

При старте сервис **синхронно** проверяет связность со всеми хранилищами, иначе fatal:

```go
db, err := connectDB(cfg.DSN())                   // 30 retry × 2s
if err != nil { log.Fatalf(...) }

minioClient, err := storage.NewMinIOClient(...)   // bucket bootstrap
if err != nil { log.Fatalf(...) }

redisClient := redis.NewClient(...)
if err := redisClient.Ping(ctx).Err(); err != nil { log.Fatalf(...) }

chConn, err := connectClickHouse(...)             // 30 retry × 2s
if err != nil { log.Fatalf(...) }
```

::: tip Почему fail-fast, а не lazy
Сервис без любого из хранилищ становится бесполезен — лучше упасть быстро, чем отдавать 500 на каждый запрос. Docker Compose с `restart: unless-stopped` поднимет контейнер заново, когда зависимости станут healthy.
:::

## Контейнер

```dockerfile
FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /analysis-api ./cmd/api

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /analysis-api .
EXPOSE 8082
CMD ["./analysis-api"]
```

## Healthchecks

```bash
# базовый
curl http://localhost:8082/health
# {"status":"ok","service":"analysis-api"}

# расширенный (admin only — JWT нужен)
curl -H "Authorization: Bearer <admin_token>" \
     http://localhost/api/v1/analysis/admin/system-status
# {
#   "postgres":   {"status":"ok"},
#   "minio":      {"status":"ok"},
#   "kafka":      {"status":"ok"},
#   "clickhouse": {"status":"ok"},
#   "start_static_queue": 0
# }
```

::: tip Зачем расширенный health
Базовый `/health` отвечает 200, пока процесс жив. Расширенный — проверяет реальный пинг каждой зависимости (`db.PingContext`, `minio.ListBuckets`, `clickhouse.Ping`, `kafka.DialLeader`). При выпадении одной из зависимостей админ-панель сразу подсветит red в `system-status`.
:::
