# HTTP API — Core API

Полный список эндпойнтов, payload-ов и кодов возврата. Базовый префикс — `/api/v1`.

## Auth (public)

### `POST /auth/register`

Регистрация нового пользователя. Сразу выдаёт токен.

::: code-group
```http [Request]
POST /api/v1/auth/register HTTP/1.1
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secret123"
}
```

```http [200 OK]
HTTP/1.1 200 OK
Content-Type: application/json

{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "user",
    "analysis_quota": 10,
    "is_active": true,
    "created_at": "2026-05-04T00:00:00Z"
  }
}
```

```http [409 Conflict]
HTTP/1.1 409 Conflict
{ "error": "user already exists" }
```
:::

### `POST /auth/login`

::: code-group
```http [Request]
POST /api/v1/auth/login
Content-Type: application/json
{ "email": "...", "password": "..." }
```

```http [200 OK]
{ "token": "...", "user": { ... } }
```

```http [401 Unauthorized]
{ "error": "invalid credentials" }
```

```http [403 Forbidden]
{ "error": "user account is disabled" }
```
:::

## Projects (user+)

Все эндпойнты требуют `Authorization: Bearer <token>` и `is_active=true`.

### `GET /projects`

```http
GET /api/v1/projects
Authorization: Bearer <token>
```

Возвращает массив проектов **текущего** пользователя.

```json
[
  { "id": "uuid", "user_id": "uuid", "name": "MyProject",
    "created_at": "2026-05-04T00:00:00Z" }
]
```

### `POST /projects`

```http
POST /api/v1/projects
Content-Type: application/json
{ "name": "NewProject" }
```

Возвращает 201 Created с созданным проектом.

### `DELETE /projects/:id`

```http
DELETE /api/v1/projects/<uuid>
```

::: warning Cascade
PostgreSQL `ON DELETE CASCADE` удалит запись о проекте, но **не** удалит файлы и задачи в `analysis_db` (см. [data-model](./data-model)).
:::

## Admin (admin only)

Все эндпойнты требуют `role=admin` в claims.

### `GET /admin/users?page=1&limit=20`

```json
{
  "users": [{ "id": "...", "email": "...", "role": "user", ... }],
  "pagination": { "page": 1, "limit": 20, "total": 42 }
}
```

`limit` ограничен в диапазоне 1–200 (см. `parsePagination`).

### `PATCH /admin/users/:id/quota`

```json
// Request
{ "analysis_quota": 50 }

// 200 OK
{ "message": "quota updated" }
```

### `PATCH /admin/users/:id/active`

```json
// Request
{ "is_active": false }

// 400 — попытка деактивировать самого себя
{ "error": "cannot deactivate yourself" }
```

### `POST /admin/users/:id/impersonate`

```json
// 200 OK
{ "token": "<JWT for the target user>" }
```

См. [Sequence: импepсонация](./flow#импepсонация-admin-only).

### `GET /admin/projects?page=1&limit=20`

```json
{
  "projects": [{
    "id": "...", "name": "...", "user_id": "...",
    "user_email": "...", "user_role": "user",
    "created_at": "..."
  }],
  "pagination": { ... }
}
```

### `GET /admin/stats`

Возвращает агрегаты пользователей и проектов.

```json
{
  "total_users": 17,
  "active_users": 15,
  "admins": 2,
  "total_projects": 42
}
```

## Health

### `GET /health`

```json
{ "status": "ok", "service": "core-api" }
```

## Сводная таблица кодов

| Код | Когда |
|---|---|
| `200` | успешный запрос |
| `201` | проект/пользователь создан |
| `400` | bad request, валидация не прошла |
| `401` | нет токена / токен невалиден / пользователь disabled |
| `403` | требуется admin |
| `404` | проект/пользователь не найден |
| `409` | дубликат email при регистрации |
| `429` | (только в analysis-api) превышена квота |
| `500` | внутренняя ошибка |
