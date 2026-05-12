# Стек и конфигурация — Core API

## Технологический стек

| Категория | Технология | Версия |
|---|---|---|
| Язык | Go | 1.22 |
| HTTP framework | [Gin](https://github.com/gin-gonic/gin) | latest |
| БД | PostgreSQL | 16 |
| ORM/SQL | [`jmoiron/sqlx`](https://github.com/jmoiron/sqlx) + `lib/pq` | latest |
| JWT | [`golang-jwt/jwt/v5`](https://github.com/golang-jwt/jwt) | v5 |
| Хеш паролей | `golang.org/x/crypto/bcrypt` | DefaultCost (10) |
| UUID | `google/uuid` | v1 |

## Переменные окружения

| Переменная | Дефолт | Где используется | Описание |
|---|---|---|---|
| `SERVER_PORT` | `8081` | `cmd/api/main.go: r.Run(":8081")` | Порт HTTP-сервера |
| `DB_HOST` | `localhost` | `config.DSN()` | Хост PostgreSQL |
| `DB_PORT` | `5432` | `config.DSN()` | Порт PostgreSQL |
| `DB_USER` | `diplom` | `config.DSN()` | Имя пользователя БД |
| `DB_PASSWORD` | `diplom_secret` | `config.DSN()` | Пароль БД |
| `DB_NAME` | `core_db` | `config.DSN()` | Имя БД |
| `REDIS_ADDR` | `localhost:6379` | `cfg.RedisAddr` | Redis (зарезервирован) |
| `REDIS_PASSWORD` | `redis_secret` | `cfg.RedisPassword` | Redis password |
| `JWT_SECRET` | `super-secret-jwt-key-for-diploma-2026` | `auth_usecase.go`, `middleware/auth.go` | Симметричный ключ HS256 |
| `AUTH_COOKIE_NAME` | `diplom_access_token` | `session_cookie.go`, `JWTAuth` | Имя HttpOnly cookie с тем же JWT, что в ответе login |
| `AUTH_COOKIE_SECURE` | `false` | `SetCookie` Secure flag | Поставить `true` в production за HTTPS |

::: warning Критичные значения
- `JWT_SECRET` **должен совпадать** между `core-api` и `analysis-api` — иначе токены не валидируются.
- `JWT_SECRET` обязательно меняется в production. Дефолтное значение пригодно только для разработки.
:::

## DSN

```go
// config.go
func (c *Config) DSN() string {
    return "postgres://" + c.DBUser + ":" + c.DBPassword +
        "@" + c.DBHost + ":" + c.DBPort + "/" + c.DBName +
        "?sslmode=disable"
}
```

::: info `sslmode=disable`
Внутри Docker-сети шифровать трафик не требуется — все коммуникации happen на bridge-сети одного хоста. В production стоит включить `verify-full` и предоставить root-сертификат.
:::

## Connection pool

```go
db.SetMaxOpenConns(25)
db.SetMaxIdleConns(5)
```

Фиксированные значения, подходящие для умеренной нагрузки. Pgbouncer пока не используется.

## Retry на старте

```go
for i := 0; i < 30; i++ {
    db, err := sqlx.Connect("postgres", dsn)
    if err == nil { return db, nil }
    time.Sleep(2 * time.Second)
}
```

30 попыток × 2 секунды = 60 секунд гонки за PostgreSQL. Этого с запасом хватает для healthy-старта в compose-сценарии.

## Контейнер

```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /core-api ./cmd/api

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /core-api .
EXPOSE 8081
CMD ["./core-api"]
```

::: tip Почему `CGO_ENABLED=0`
Дисэйбл CGO даёт **полностью статичный бинарник**, который запускается на любой минимальной alpine без libc. Это упрощает кросс-компиляцию и уменьшает образ.
:::

## Команды разработки

```bash
# из директории core-api-service
go run ./cmd/api      # запуск с локальным окружением
go test ./...         # юниты
go vet ./...          # статика
```
