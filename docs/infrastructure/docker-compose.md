# Docker Compose

Полный compose-файл живёт в `infra/docker-compose.yml`. Эта страница — построчный разбор и обоснование каждого блока.

## Структура

Файл разбит на 4 блока:

1. **Infrastructure** — postgres, redis, minio, clickhouse, zookeeper, kafka.
2. **API Gateway** — nginx.
3. **Frontend** — Vue 3 SPA.
4. **Services** — core-api, analysis-api, worker-static, worker-cache.

## Postgres + init

```yaml
postgres:
  image: postgres:16-alpine
  environment:
    POSTGRES_USER: ${POSTGRES_USER}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    CORE_DB_NAME: ${CORE_DB_NAME}
    ANALYSIS_DB_NAME: ${ANALYSIS_DB_NAME}
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
    interval: 5s
    retries: 10

postgres-init:
  image: postgres:16-alpine
  depends_on:
    postgres: { condition: service_healthy }
  command: |
    if не существует CORE_DB → createdb CORE_DB
    if не существует ANALYSIS_DB → createdb ANALYSIS_DB
```

::: tip Почему отдельный init-контейнер
PostgreSQL образ умеет выполнять `init.sql` только при первой инициализации volume. Если БД уже создана, скрипты пропускаются. `postgres-init` решает это явно: проверяет `pg_database` каждый запуск и создаёт нужные БД, если их нет. Это идемпотентно и переживает `docker compose down` без удаления volume.
:::

## MinIO + bucket bootstrap

```yaml
minio-init:
  image: minio/mc:latest
  depends_on:
    minio: { condition: service_healthy }
  entrypoint: ["/bin/sh", "/init-buckets.sh"]
  volumes:
    - ./minio/init-buckets.sh:/init-buckets.sh
```

`init-buckets.sh` создаёт `source-codes` и `analysis-artifacts`. Если бакет уже существует — `mc mb --ignore-existing` тихо пропускает.

::: info Дублирование bucket-creation
Аналогичная логика есть в `analysis-api-service/internal/storage/minio.go` (`BucketExists` + `MakeBucket`). Это сознательная избыточность: при старте API без `minio-init` (например, в тестах) сервис всё равно поднимется.
:::

## Kafka + ZooKeeper

```yaml
kafka:
  image: confluentinc/cp-kafka:7.6.0
  environment:
    KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
    KAFKA_ADVERTISED_LISTENERS: >-
      PLAINTEXT://kafka:29092,
      PLAINTEXT_HOST://localhost:${KAFKA_BROKER_PORT}
    KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"
```

::: tip Почему два listener-а
Контейнеры в одной сети (`analysis-api`, `worker-static`, `worker-cache`) обращаются к `kafka:29092`. Любой клиент извне (например, kafka-console-consumer с хоста) — по `localhost:${KAFKA_BROKER_PORT}` (по умолчанию 9092). Без двух advertised listener-ов один из режимов сломается.
:::

::: warning AUTO_CREATE_TOPICS_ENABLE=true
Сделано ради простоты dev-окружения. В продакшене топики создаются с явной партиционностью и replication-factor. Здесь Kafka сам создаст топик при первой публикации с дефолтными параметрами (1 партиция, RF=1).
:::

## ClickHouse

```yaml
clickhouse:
  image: clickhouse/clickhouse-server:24-alpine
  volumes:
    - ./clickhouse/init.sql:/docker-entrypoint-initdb.d/init.sql
```

`init.sql` создаёт БД `analysis_metrics` и две таблицы: `static_patterns`, `dynamic_pattern_metrics` (см. [ClickHouse schema](/contracts/clickhouse)).

## Workers — лимиты и окружение

```yaml
worker-static:
  build: ../worker-static-analyzer
  mem_limit: 512m
  cpus: 1.0
  environment:
    KAFKA_BROKERS: kafka:29092
    MINIO_ENDPOINT: minio:9000
    CLICKHOUSE_ADDR: clickhouse:9000
    ...
```

::: info mem_limit и cpus
Воркеры — потенциальный источник OOM (clang AST на больших файлах, valgrind на циклах в миллионах итераций). Лимиты в 512 MB / 1 CPU дают:

- предсказуемое поведение при нагрузке;
- невозможность одного воркера съесть всю машину;
- быстрый OOM-kill вместо зависания всей docker-сети.
:::

## Volumes

```yaml
volumes:
  postgres_data:
  redis_data:
  minio_data:
  clickhouse_data:
  zookeeper_data:
  kafka_data:
```

Все stateful-сервисы используют именованные volumes, чтобы пережить `docker compose down` (но не `docker compose down -v` — это удалит данные).

## Сводка переменных окружения

```ini
POSTGRES_USER=diplom
POSTGRES_PASSWORD=diplom_secret
CORE_DB_NAME=core_db
ANALYSIS_DB_NAME=analysis_db
POSTGRES_PORT=5432

REDIS_PASSWORD=redis_secret
REDIS_PORT=6379

MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin123
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001

CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=clickhouse_secret
CLICKHOUSE_DB=analysis_metrics
CLICKHOUSE_PORT=8123
CLICKHOUSE_NATIVE_PORT=9000

KAFKA_BROKER_PORT=9092
NGINX_PORT=80

CORE_API_PORT=8081
ANALYSIS_API_PORT=8082
JWT_SECRET=super-secret-jwt-key-for-diploma-2026
```

::: warning Секреты по умолчанию
В `.env.example` лежат удобные дефолты для разработки. **Перед публичным деплоем** обязательно сменить `JWT_SECRET`, `MINIO_ROOT_PASSWORD`, `CLICKHOUSE_PASSWORD`, `REDIS_PASSWORD`.
:::
