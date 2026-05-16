---
layout: home

hero:
  name: Diploma Platform
  text: Анализ кэш-поведения C-кода
  tagline: Единая техническая документация платформы — статический AST-анализ + динамическая cache-симуляция, упакованные в event-driven систему из 7 сервисов. Поднимается одной командой `make up`.
  actions:
    - theme: brand
      text: Архитектура
      link: /architecture/
    - theme: alt
      text: Контракты Kafka и HTTP
      link: /contracts/

features:
  - icon: 🏛
    title: Event-driven архитектура
    details: Два асинхронных воркера и API общаются через 4 Kafka-топика. Lifecycle задачи защищён детерминированным FSM.
    link: /architecture/event-flow
  - icon: 🧱
    title: Стек хранилищ
    details: PostgreSQL для оперативных таблиц, ClickHouse для метрик, MinIO для исходников и артефактов, Redis для квот.
    link: /infrastructure/
  - icon: 🟦
    title: Backend на Go (Clean Arch)
    details: Core API (users/projects/JWT) и Analysis API (orchestration), оба следуют слоям handler → usecase → repository.
    link: /backend/core-api/
  - icon: 🟪
    title: Воркеры
    details: Static — извлечение паттернов памяти из `.c` внешним бинарием. Cache — симулятор кэша (`INTERPRETER_BINARY`, параметры задаёт сборка образа и сам симулятор; см. [worker-cache-interpreter](/workers/cache-interpreter/)).
    link: /workers/static-analyzer/
  - icon: 🟩
    title: Vue 3 (FSD) + VS Code
    details: Веб-клиент с Pinia/Monaco и расширение VS Code с локальным web-tree-sitter для in-editor подсказок.
    link: /clients/frontend/
  - icon: 📜
    title: Контракты как первый класс
    details: Kafka-события и HTTP-маршруты задокументированы с payload, статусами и переходами FSM.
    link: /contracts/kafka
---

## Что это за платформа

Платформа принимает `.c` файл от пользователя, асинхронно прогоняет его через два независимых воркера и возвращает агрегированную метрику кэш-поведения (hit/miss, optimization score) — как в браузере, так и прямо в редакторе VS Code.

::: info Главные фичи
- **Загрузка `.c` → задача анализа** через `POST /api/v1/analysis/upload`: дедуп по SHA-256, в форме **обязательно** указывается `cache_config_id` (JSON-конфиг из `GET`/`POST /analysis/cache-configs`) — и в веб-Sandbox, и в VS Code-расширении.
- **Список файлов проекта** в Sandbox (`GET /analysis/projects/:project_id/files`): **мягкое удаление** (`DELETE /analysis/files/:file_id`) скрывает файл в UI, данные в MinIO остаются; список задач по проекту фильтруется по видимым файлам.
- **Повторный анализ без повторной загрузки** — `POST /analysis/files/:id/analyze` при неизменном буфере Sandbox/редактора.
- **Статический анализ** воркером `worker-static-analyzer` (бинарник `cmd.exe` под wine).
- **Динамическая симуляция кэша** воркером `worker-cache-interpreter`: внешний бинарь (`INTERPRETER_BINARY`, по умолчанию в коде — `cats`-совместимый путь в Linux-контейнере), результат в MinIO как `cache-out.json`; метрики для UI считает Analysis API из L1 блока этого JSON.
- **Маппинг динамических miss-ов на статические паттерны** по `(source_file, base_symbol, cache_level)`.
- **Светлая/тёмная тема** + русский UI, переключаемые в шапке и сохраняющиеся в `localStorage`.
- **Встроенный быстрый анализ** в VS Code (`web-tree-sitter`) и полный удалённый путь с тем же **`cache_config_id`**, что и в браузере.
:::

## Карта сервисов

```mermaid
flowchart LR
    subgraph Clients
      FE[diploma-frontend<br/>Vue 3 + Pinia]
      VS[diploma-vscode<br/>web-tree-sitter]
    end

    subgraph Backend
      NG[Nginx Gateway]
      CORE[core-api-service<br/>Go + Gin]
      ANA[analysis-api-service<br/>Go + Gin]
    end

    subgraph Workers
      WS[worker-static-analyzer<br/>clang AST → Pattern]
      WC[worker-cache-interpreter<br/>L1+L2 LRU sim]
    end

    subgraph Storage
      PG[(PostgreSQL)]
      RD[(Redis)]
      MN[(MinIO)]
      CH[(ClickHouse)]
      KF[[Kafka]]
    end

    FE --> NG
    VS --> NG
    NG --> CORE
    NG --> ANA

    CORE --> PG
    ANA --> PG
    ANA --> MN
    ANA --> RD
    ANA --> CH
    ANA -- start_static / start_cache --> KF
    KF -- start_static --> WS
    KF -- start_cache --> WC
    WS -- static_completed --> KF
    WC -- cache_completed --> KF
    KF -- *_completed --> ANA
    WS --> CH
    WS --> MN
    WC --> CH
    WC --> MN
```

## Как читать эту документацию

::: tip Рекомендуемый порядок
1. [Архитектура → Обзор системы](/architecture/) — общая картина.
2. [Архитектура → Event-driven поток](/architecture/event-flow) — как живёт одна задача.
3. [Инфраструктура](/infrastructure/) — компоновка `docker compose`.
4. Внутренняя документация конкретного сервиса (см. левое меню).
5. [Контракты](/contracts/) — справочник по событиям и эндпойнтам.
:::

## Запуск документации

Портал поставляется как Docker-контейнер на `nginx:alpine`.

::: code-group
```bash [платформа и доки отдельно]
# терминал 1 — в каталоге diploma-infra (БД, API, воркеры, gateway)
make up                       # эквивалент docker compose up -d --build
# UI приложения: http://localhost:8080  (NGINX_PORT из .env)

# терминал 2 — в каталоге docs-portal
docker compose up -d docs
# документация: http://localhost:8088
```

```bash [только доки (отдельный compose)]
# в каталоге docs-portal
docker compose up -d docs
# открыть http://localhost:8088
```

```bash [dev hot-reload]
docker compose --profile dev up docs-dev
# открыть http://localhost:5173 — правки .md подхватываются на лету
```

```bash [локально (без Docker)]
npm install
npm run docs:dev
```
:::

::: tip Базовый путь сайта
Dockerfile собирает VitePress с **`VITEPRESS_BASE=/`** (корень), как в `docs-portal/docker-compose.yml` — сайт открывается на порту **8088** без префикса.
:::

::: warning Локальная разработка
Автономный портал на **8088** не проверяет роль пользователя; не путайте с защищёнными эндпойнтами API платформы.
:::
