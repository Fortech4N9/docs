# Стек и конфигурация — Worker Cache

## Технологический стек

| Категория | Технология |
|---|---|
| Язык | Go 1.22 |
| Kafka | `segmentio/kafka-go` |
| MinIO | `minio-go/v7` |
| Системные | внешний симулятор кэша (**`INTERPRETER_BINARY`**, см. Dockerfile/образ) |

::: tip Без CGO для самого парсера
Воркер собирается чистым Go-бинарём. Парсер результата — в репозитории; платформенные зависимости определяются **выбранным бинарием симулятора** в вашем образе.
:::

## Переменные окружения

| Переменная | Дефолт | Назначение |
|---|---|---|
| `KAFKA_BROKERS` | `localhost:9092` | Kafka bootstrap (можно несколько через запятую) |
| `MINIO_ENDPOINT` | `localhost:9000` | MinIO API |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO access |
| `MINIO_SECRET_KEY` | `minioadmin123` | MinIO secret |
| `INTERPRETER_BINARY` | `/usr/local/bin/cats` | путь до исполняемого файла симулятора; строка запуска: `<binary> <basename.c> json`, `cmd.Dir` = каталог с файлом |

::: info Совместимость с Wine-образом
В некоторых Docker-ветках симулятор по-прежнему может быть Windows PE под `wine` — тогда путь и обёртка запуска настраиваются в образе, а Go-код всё равно вызывает `exec.Command` с указанным `INTERPRETER_BINARY`.
:::

::: info ClickHouse-переменные присутствуют, но не используются
В `internal/config/config.go` исторически объявлены `CLICKHOUSE_*`. Текущий `cmd/main.go` их не читает: воркер не пишет напрямую в ClickHouse — это делает `analysis-api-service` после получения `cache_completed`. Поля оставлены, чтобы не делать breaking change в `.env`.
:::

## Контейнер

```dockerfile
# Stage 1: Go-builder.
FROM --platform=linux/amd64 golang:1.22-bookworm AS builder
WORKDIR /app
COPY worker-cache-interpreter/go.mod worker-cache-interpreter/go.sum ./
RUN go mod download
COPY worker-cache-interpreter/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /worker-cache ./cmd

# Stage 2: runtime — Ubuntu 22.04 + winehq-stable + CacheSim.exe.
FROM --platform=linux/amd64 ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive WINEDEBUG=-all WINEPREFIX=/root/.wine WINEARCH=win64

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg2 software-properties-common && \
    rm -rf /var/lib/apt/lists/*

RUN dpkg --add-architecture i386 && \
    mkdir -pm755 /etc/apt/keyrings && \
    curl -fsSL https://dl.winehq.org/wine-builds/winehq.key \
        -o /etc/apt/keyrings/winehq-archive.key && \
    curl -fsSL https://dl.winehq.org/wine-builds/ubuntu/dists/jammy/winehq-jammy.sources \
        -o /etc/apt/sources.list.d/winehq-jammy.sources && \
    apt-get update && \
    apt-get install -y --no-install-recommends winehq-stable && \
    rm -rf /var/lib/apt/lists/*

RUN wine wineboot --init 2>/dev/null || true

WORKDIR /app
COPY --from=builder /worker-cache /usr/local/bin/worker-cache
COPY worker-cache-interpreter/CacheSim.exe /usr/local/bin/CacheSim.exe
COPY worker-cache-interpreter/entrypoint.sh /usr/local/bin/entrypoint.sh

# Защита от CRLF, если файл редактировался на macOS/Windows.
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh && \
    chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

В `compose` сервис закреплён за `linux/amd64`, образ собирается под эту же платформу.

## Compose

```yaml
worker-cache:
  build:
    context: ..
    dockerfile: worker-cache-interpreter/Dockerfile
  image: diploma-fix-worker-cache:latest
  platform: linux/amd64
  environment:
    KAFKA_BROKERS: kafka:29092
    MINIO_ENDPOINT: minio:9000
    MINIO_ACCESS_KEY: ${MINIO_ROOT_USER}
    MINIO_SECRET_KEY: ${MINIO_ROOT_PASSWORD}
    INTERPRETER_BINARY: /usr/local/bin/CacheSim.exe
```

## Apple Silicon: Lima-override

`CacheSim.exe` — Win64 PE-бинарь, запускается через `wine`. На Apple Silicon Docker Desktop / OrbStack используют QEMU user-mode эмуляцию, и `wine` под ней нестабильно работает с этим конкретным бинарём (классический ассерт `anon_mmap_fixed` в `dlls/ntdll/unix/virtual.c`). Поэтому для cache-стадии на ARM-маках предусмотрен опциональный путь — поднять весь стек внутри Lima x86_64 VM, где ядро Linux настоящее x86_64.

`diploma-infra/docker-compose.lima.yml` — override-файл, подключаемый к базовому compose только при запуске в Lima:

```yaml
services:
  worker-cache:
    # Дефолтный Docker seccomp-profile режет часть syscalls, которые
    # использует wine (socket-семейство, ptrace и т.п.).
    security_opt:
      - seccomp:unconfined

  clickhouse:
    image: clickhouse/clickhouse-server:24.3
    cap_add: [SYS_NICE, IPC_LOCK, NET_ADMIN]
    security_opt:
      - seccomp:unconfined
    ulimits:
      nofile:
        soft: 262144
        hard: 262144

  clickhouse-init:
    image: clickhouse/clickhouse-server:24.3
```

Команда из `diploma-infra/Makefile`:

```sh
make lima-up        # развернуть Ubuntu 22.04 amd64 VM с Docker внутри
make lima-stack     # docker compose up -d --build с lima-override
```

::: info x86_64-хост ничего такого не требует
Если воркер запускается на нативном Linux x86_64 (или на Mac Intel), Lima не нужна — обычного `make up` достаточно.
:::

## Команды разработки

```bash
cd worker-cache-interpreter
go build -o ./bin/worker-cache ./cmd

# Нужны установленные wine и CacheSim.exe рядом:
INTERPRETER_BINARY=$PWD/CacheSim.exe ./bin/worker-cache
```
