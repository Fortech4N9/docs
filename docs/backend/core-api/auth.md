# JWT и middleware

## Формат токена

Алгоритм — **HMAC-SHA256** (HS256). Секрет — `JWT_SECRET`. Срок жизни — **24 часа**.

Claims, которые кладёт `auth_usecase.generateToken`:

```json
{
  "user_id": "uuid-v4",
  "email": "user@example.com",
  "role": "user|admin",
  "analysis_quota": 10,
  "is_active": true,
  "exp": 1735689600,
  "iat": 1735603200
}
```

## Зачем именно эти claims

::: tip
- `user_id` — обязательный для любых владельческих проверок (например, "это ли мой проект?").
- `role` — позволяет middleware решить admin/non-admin без обращения к БД.
- `analysis_quota` — `analysis-api` читает квоту прямо из токена и делает `INCR` в Redis. Так один HTTP-запрос на upload не превращается в три (auth → quota → upload).
- `is_active` — сразу блокируем токен залоченного пользователя без обращения к БД (хотя сервер всё равно дополнительно проверит — см. `RequireActiveUser`).
:::

::: warning Trade-off с claims
Поскольку `analysis_quota` и `is_active` живут в токене, изменения через `PATCH /admin/...` применяются только при следующем логине. Это сознательное упрощение — иначе придётся делать revoke-list или короткие токены с refresh-ами.
:::

## HttpOnly cookie

Чтобы браузерный клиент мог отправлять JWT **без заголовка** `Authorization` (удобно для запросов, куда браузер не кладёт Bearer сам), при успешном **`login`**, **`register`** и **`impersonate`** core-api выставляет cookie **`AUTH_COOKIE_NAME`** (по умолчанию `diplom_access_token`): те же 24h HS256, флаги **HttpOnly**, **SameSite=Lax**, путь **`/`**. Middleware **`JWTAuth`** принимает токен и из заголовка Bearer, и из этой cookie (приоритет у Bearer). Если снова включён nginx **`auth_request`** на защищённый статический маршрут, cookie будет видна и на subrequest.

Сброс cookie — **`POST /auth/logout`** (публичный маршрут).

::: warning Автономный docs-portal
Сборка `docs-portal` на порту **8088** cookie для доступа к докам **не использует** — там статика без проверки роли (локальная документация).
:::

## Генерация токена

```go
// auth_usecase.go
func (uc *AuthUseCase) generateToken(user *model.User) (string, error) {
    claims := jwt.MapClaims{
        "user_id":        user.ID,
        "email":          user.Email,
        "role":           user.Role,
        "analysis_quota": user.AnalysisQuota,
        "is_active":      user.IsActive,
        "exp":            time.Now().Add(24 * time.Hour).Unix(),
        "iat":            time.Now().Unix(),
    }
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString([]byte(uc.jwtSecret))
}
```

## Регистрация и логин

### Register

```go
func (uc *AuthUseCase) Register(ctx, req) (*AuthResponse, error) {
    if existing, _ := uc.userRepo.GetByEmail(ctx, req.Email); existing != nil {
        return nil, ErrUserExists
    }
    hash, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    user := &model.User{
        ID: uuid.New().String(),
        Email: req.Email,
        PasswordHash: string(hash),
        Role: "user",
        AnalysisQuota: 10,
        IsActive: true,
        CreatedAt: time.Now().UTC(),
    }
    uc.userRepo.Create(ctx, user)
    token, _ := uc.generateToken(user)
    return &AuthResponse{Token: token, User: *user}, nil
}
```

### Login

```go
func (uc *AuthUseCase) Login(ctx, req) (*AuthResponse, error) {
    user, err := uc.userRepo.GetByEmail(ctx, req.Email)
    if err != nil { return nil, ErrInvalidCredentials }
    if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash),
                                            []byte(req.Password)); err != nil {
        return nil, ErrInvalidCredentials
    }
    if !user.IsActive { return nil, ErrUserDisabled }
    token, _ := uc.generateToken(user)
    return &AuthResponse{Token: token, User: *user}, nil
}
```

::: info Защита от user enumeration
И "пользователя нет", и "пароль неверный" возвращают **один и тот же** `ErrInvalidCredentials`. Снаружи нельзя отличить "не существует" от "неверный пароль" — это базовая защита от перебора email-ов.
:::

::: tip Почему `bcrypt`, а не SHA-256
`bcrypt` намеренно медленный (~100ms на хеш с DefaultCost=10). Это делает brute-force в десятки тысяч раз дороже, чем для голого SHA. Стандартный выбор для production-grade аутентификации.
:::

## Middleware цепочка

### `JWTAuth(secret)`

```go
authHeader := c.GetHeader("Authorization")
parts := strings.SplitN(authHeader, " ", 2)
// parts[0] == "Bearer", parts[1] == token

token, err := jwt.Parse(parts[1], func(t *jwt.Token) (interface{}, error) {
    if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
        return nil, jwt.ErrSignatureInvalid
    }
    return []byte(secret), nil
})

claims := token.Claims.(jwt.MapClaims)
if !claims["is_active"].(bool) { return 401 }

c.Set("user_id", claims["user_id"])
c.Set("email", claims["email"])
c.Set("role", claims["role"])
c.Set("analysis_quota", int(claims["analysis_quota"].(float64)))
```

::: warning Проверка алгоритма
Явная проверка `t.Method.(*jwt.SigningMethodHMAC)` защищает от классической атаки "alg=none". Без неё JWT-библиотека бы радостно приняла токен с подменённым алгоритмом.
:::

### `RequireActiveUser(userRepo)`

После `JWTAuth` подтверждает: пользователь действительно существует и не заблокирован **на момент запроса** (а не на момент выдачи токена).

```go
user, _ := userRepo.GetByID(ctx, c.GetString("user_id"))
if !user.IsActive { return 401 "account is disabled" }
```

Это даёт админу возможность мгновенно отключить пользователя — токен в кармане у клиента остаётся действительным по подписи, но с запросом происходит lookup в БД.

### `RequireAdmin`

```go
if c.GetString("role") != "admin" { return 403 }
```

Простейшая проверка role — без обращения к БД, потому что роль уже в claims.

## Почему `is_active` проверяется и в claim, и в БД

::: tip
- Claim проверяется первым — это бесплатно и отлавливает 99% случаев.
- БД-проверка ловит ситуацию "токен выпущен 5 минут назад, потом пользователя заблокировали".
- Эта дублирующая проверка значит: после блокировки никакие запросы не пройдут максимум через 1 round-trip к БД (в рамках того же запроса).
:::
