# 📚 Diploma Platform Docs

Единая техническая документация платформы анализа C-кода (7 микросервисов) — на VitePress, с Mermaid-диаграммами, в Docker-контейнере на nginx.

## TL;DR

```bash
# Production (статика + nginx)
docker compose up -d docs
open http://localhost:8088

# Dev (vitepress dev с hot-reload)
docker compose --profile dev up docs-dev
open http://localhost:5173
```

## Структура

```
docs-portal/
├── docs/                       # источник документации
│   ├── .vitepress/config.ts    # конфиг VitePress + Mermaid + sidebar
│   ├── index.md                # главная
│   ├── architecture/           # обзор + event-flow + FSM + принципы
│   ├── infrastructure/         # postgres, clickhouse, minio, kafka, redis, nginx, compose
│   ├── backend/
│   │   ├── core-api/           # 7 страниц (overview, config, data-model, architecture, auth, flow, api)
│   │   └── analysis-api/       # 9 страниц с орк/квотами/метриками
│   ├── workers/
│   │   ├── static-analyzer/    # AST + walker + flow
│   │   └── cache-interpreter/  # cachegrind + distribute + flow
│   ├── clients/
│   │   ├── frontend/           # FSD + Pinia + Monaco + screens
│   │   └── vscode/             # tree-sitter + providers + flow
│   └── contracts/              # Kafka, HTTP, ClickHouse, общие типы
├── package.json                # vitepress + vitepress-plugin-mermaid
├── Dockerfile                  # multi-stage: Node 22 + git → vitepress build → nginx serve
├── Dockerfile.dev              # vitepress dev для hot reload
├── docker-compose.yml          # production (docs) + dev (docs-dev профиль)
├── nginx.conf                  # SPA-friendly serving + cache headers + /health
└── .gitignore
```

## Возможности

- **Mermaid диаграммы** прямо в Markdown через `vitepress-plugin-mermaid`.
- **Sequence-диаграммы** ключевых бизнес-флоу (login, upload→done, AST, cachegrind).
- **ER-диаграммы** PostgreSQL и ClickHouse.
- **Dark mode** из коробки.
- **Локальный поиск** (`themeConfig.search.provider = 'local'`).
- **Code groups** для side-by-side сравнения (`::: code-group` блоки).
- **Custom containers** (`::: tip`, `::: warning`, `::: info`).

## Скрипты

| Скрипт | Что делает |
|---|---|
| `npm run docs:dev` | Vite dev-server на :5173 (hot reload) |
| `npm run docs:build` | Production build → `docs/.vitepress/dist/` |
| `npm run docs:preview` | Preview build на :4173 |

## Локальный запуск (без Docker)

```bash
npm install
npm run docs:dev
# http://localhost:5173
```

## Production build (без Docker)

```bash
npm run docs:build
# можно отдать любой статикой:
npx http-server docs/.vitepress/dist
```

## Healthcheck

`http://localhost:8088/health` → `{"status":"ok","service":"docs"}`

## Переменные окружения

| Переменная | Дефолт | Назначение |
|---|---|---|
| `DOCS_PORT` | `8088` | Хост-порт production-контейнера |
| `DOCS_DEV_PORT` | `5173` | Хост-порт dev-контейнера |
| `COMPOSE_NETWORK_NAME` | `diploma-docs-net` | Имя docker network |

## Запуск рядом с основной системой

Платформа (`infra`) и доки поднимаются **отдельными** `docker compose`. Доки:

```bash
cd docs-portal && docker compose up -d docs   # http://localhost:8088
```
