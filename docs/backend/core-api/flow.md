# Sequence: login и защищённый запрос

## Login → Token

```mermaid
sequenceDiagram
    autonumber
    actor U as Пользователь
    participant FE as Frontend
    participant NG as Nginx
    participant H as auth_handler.Login
    participant UC as AuthUseCase.Login
    participant R as UserRepository
    participant PG as PostgreSQL

    U->>FE: вводит email/password
    FE->>NG: POST /api/v1/auth/login {email, password}
    NG->>H: проксирует
    H->>UC: Login(ctx, LoginRequest)
    UC->>R: GetByEmail(email)
    R->>PG: SELECT * FROM users WHERE email=$1
    PG-->>R: row
    R-->>UC: *User
    UC->>UC: bcrypt.CompareHashAndPassword(hash, password)
    alt password OK + active
      UC->>UC: generateToken(user) (HS256, 24h)
      UC-->>H: AuthResponse{token, user}
      H-->>FE: 200 {token, user}
      FE->>FE: localStorage.setItem('token', token)
    else password fail
      UC-->>H: ErrInvalidCredentials
      H-->>FE: 401 {error: invalid credentials}
    end
```

## Защищённый запрос (например, GET /projects)

```mermaid
sequenceDiagram
    autonumber
    actor U as Пользователь
    participant FE as Frontend
    participant NG as Nginx
    participant M1 as JWTAuth
    participant M2 as RequireActiveUser
    participant H as project_handler.List
    participant UC as ProjectUseCase
    participant R as ProjectRepository
    participant PG as PostgreSQL

    U->>FE: открывает /dashboard
    FE->>NG: GET /api/v1/projects<br/>Authorization: Bearer <token>
    NG->>M1: проксирует
    M1->>M1: parse + verify JWT (HMAC)
    alt invalid
      M1-->>FE: 401 invalid token
    else valid
      M1->>M1: c.Set('user_id', claims.user_id)
      M1->>M2: next()
      M2->>PG: SELECT * FROM users WHERE id=$1
      alt is_active=false
        M2-->>FE: 401 account is disabled
      else
        M2->>H: next()
        H->>UC: ListByUser(ctx, userID)
        UC->>R: GetByUserID(userID)
        R->>PG: SELECT * FROM projects WHERE user_id=$1
        PG-->>R: rows
        R-->>UC: []Project
        UC-->>H: []Project
        H-->>FE: 200 [...]
      end
    end
```

## Импepсонация (admin only)

```mermaid
sequenceDiagram
    autonumber
    actor A as Admin
    participant FE as Frontend
    participant H as admin_handler.Impersonate
    participant UC as AdminUseCase
    participant Auth as AuthUseCase
    participant R as UserRepository

    A->>FE: "Войти как пользователя X"
    FE->>H: POST /api/v1/admin/users/X/impersonate
    Note over H: middleware: JWTAuth + RequireAdmin
    H->>UC: Impersonate(ctx, X)
    UC->>R: GetByID(X)
    R-->>UC: *User
    UC->>Auth: GenerateToken(user)
    Auth-->>UC: token
    UC-->>H: token
    H-->>FE: 200 {token: "..."}
    FE->>FE: tmp = localStorage.token<br/>localStorage.token = newToken
    FE->>FE: navigate to /dashboard
```

::: tip
Импepсонация просто выдаёт **новый JWT** на чужого пользователя — никакого "режима имперсонации" с особым флагом. Это упрощает код: для бэкенда impersonated-сессия выглядит как обычная сессия пользователя X. Аудит ведётся через логи admin-действий (на уровне gin middleware).
:::

::: warning Безопасность
- Эндпойнт защищён `RequireAdmin`, поэтому только admin может его вызвать.
- В production нужно добавить аудит-лог "admin Y impersonated as user X at timestamp T".
- Длинный TTL токена (24ч) означает, что admin "становится" пользователем на сутки — рекомендую сократить до 1ч специально для имперсонации.
:::
