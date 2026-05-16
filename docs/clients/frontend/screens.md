# UI Screens

Описание ключевых экранов веб-клиента: какой компонент за что отвечает и какие данные показывает.

::: info Скриншоты и мокапы
Ниже — **иллюстративные SVG-мокапы** (в репозитории: `docs/public/screenshots/`). Их можно заменить на реальные PNG/WebP без смены путей — достаточно положить файлы с тем же именем и расширением и обновить ссылки в Markdown.
:::

## Login / Register

```
┌──────────────────────────────────────┐
│       Diploma Platform              │
│                                      │
│  ┌────────────────────────────────┐ │
│  │  Email:    [_______________]   │ │
│  │  Password: [_______________]   │ │
│  │                                │ │
│  │  [   Войти   ]                 │ │
│  │  Нет аккаунта? → Регистрация   │ │
│  └────────────────────────────────┘ │
└──────────────────────────────────────┘
```

- `pages/LoginPage.vue` + `features/auth/LoginForm.vue`.
- При успехе — token в localStorage, redirect на `/dashboard`.

## Dashboard

![Мокап Dashboard — список проектов](/screenshots/frontend-dashboard.svg)

```
┌────────────────────────────────────────────────┐
│  Header: [logo] [user@email] [выход] [admin?]  │
├────────────────────────────────────────────────┤
│  Мои проекты                  [+ Новый]        │
│  ┌──────────────┐ ┌──────────────┐             │
│  │ Проект A     │ │ Проект B      │             │
│  │ 3 файла      │ │ 1 файл       │             │
│  │ → открыть    │ │ → открыть    │             │
│  └──────────────┘ └──────────────┘             │
└────────────────────────────────────────────────┘
```

- `pages/DashboardPage.vue`.
- Использует `useProjectStore.fetchProjects` на mount.
- Каждая карточка — `widgets/ProjectCard.vue`.
- «Новый» открывает `widgets/CreateProjectModal.vue`.

## Project Page (главный экран)

![Мокап страницы проекта — файлы, pipeline, метрики](/screenshots/frontend-project.svg)

```
┌────────────────────────────────────────────────────────────────┐
│  Header                                                         │
├────────────────────────────────────────────────────────────────┐
│  Проект: MyProject                                              │
├──────────────────────────┬─────────────────────────────────────┤
│  Файлы                   │  Статус пайплайна                    │
│  ─ main.c    [✓ готово]  │  В очереди → статический анализ →    │
│  ─ utils.c   [⏳ стат.]  │  кэш-симуляция → завершено            │
│  [↑ Загрузить .c]       │                                       │
│                          │ [Подробнее] → модальное окно результатов │
│                          │  · доля попаданий / промахов           │
│                          │  · таблица паттернов (aggregated /    │
│                          │    static fallback)                    │
│                          │  · error_message задачи если был сбой  │
└──────────────────────────┴─────────────────────────────────────┘
```

- `pages/ProjectPage.vue`.
- Перед загрузкой `.c` пользователь выбирает **`CacheSimulatorConfig`** (виджет `widgets/CacheSimulatorConfigToolbar.vue`): без `cache_config_id` бэкенд не примет `POST /analysis/upload`.
- Список задач — `useAnalysisStore.fetchProjectTasks`.
- При выборе задачи — `useAnalysisPolling(taskId)` до `done|error`; в UI показываются **`error_message`** и **`reused_from_task_id`** когда приходят с API.
- **Метрики и паттерны** — после завершения: `fetchTaskMetrics` + `fetchTaskAggregated`; при пустом `/aggregated` делается `fetchTaskStaticPatterns` (то же правило у Sandbox и VS Code клиента).

### Виджеты

| Компонент | Назначение |
|---|---|
| `widgets/CacheSimulatorConfigToolbar.vue` | Список/загрузка/удаление конфигов симулятора; выбранный id уходит в `cache_config_id` при upload/analyze. |
| `widgets/AnalysisPipelineStatus.vue` | Шаги пайплайна, русские подписи статусов (`STATUS_LABELS`), reuse, кнопка «Подробнее». |
| `widgets/MetricsPanel.vue` | Модальное окно «Результаты анализа» с `widgets/ExtendedResultsPanel.vue`: карточки L1, фильтры по типу/уровню кэша, таблица, экспорт JSON, баннер ошибки воркера. |

### AnalysisPipelineStatus

Подсвечивает текущий этап задачи по FSM из бэкенда.

::: tip Координировать типы
Список статусов синхронизирован с `TaskStatus` в `entities/analysis/model/types.ts` и с Go-моделями задачи на API.
:::

## Admin pages

### `/admin/users`

```
┌──────────────────────────────────────────────────────────────┐
│  email                  role    quota   active  действия      │
│  user@example.com       user    10      ✓       [правка] [⛔]  │
│  admin@system.local     admin   1000    ✓       [правка]      │
│                                                              │
│  Pagination: ‹ 1 2 3 ›                                       │
└──────────────────────────────────────────────────────────────┘
```

- Использует `useAdminStore.fetchUsers(page, limit)`.
- правка quota → `PATCH /admin/users/:id/quota`.
- «⛔» → `PATCH /admin/users/:id/active`.

### `/admin` — дашборд

- Верхний ряд KPI по core + analysis статистике.
- Блок «Самые частые паттерны»: **горизонтальный Bar + Doughnut** (vue-chartjs), подписи тултипов с человекочитаемым именем паттерна (`patternLabel`).
- Полный список `pattern_type` с цветными бэйджами качества.

## Sandbox (`/sandbox`)

Инструмент после входа (**`requiresAuth`**), реализация — `pages/SandboxPage.vue`.

- **Проект** выбирается из списка `GET /projects` (никакого фиксированного проекта «Sandbox»); последний выбор — `localStorage` (`sandbox_selected_project_id`).
- **Файлы** в левой колонке — `GET /analysis/projects/:project_id/files`; отображаются только записи без мягкого удаления (`deleted_at IS NULL`).
- **Скрыть из списка** — для каждой строки есть кнопка с корзиной → `DELETE /analysis/files/:file_id`; объект MinIO сохранён, файл исчезает из сайдбара; пользователь может «вернуть» запись тем же содержимым через повторную загрузку с тем же `sha256` (сервер восстанавливает строку, см. [Analysis API — файлы](/backend/analysis-api/api)).
- **Конфиг симулятора** — обязателен перед `Анализировать` (виджеты `widgets/CacheSimulatorConfigToolbar.vue` + `widgets/CacheConfigGateModal.vue` при попытке запуска без `cache_config_id`).
- Monaco, декорации, `ExtendedResultsPanel` — см. блоки результатов ниже по страницам документации.

::: tip Отличие от `/projects/:id`
Песочница не привязана к одному `project_id` в коде — пользователь явно переключает проект и работает с файлами внутри него.
:::

## Header & Layout

`widgets/AppHeader.vue`:

- Логотип / название
- Email пользователя + бейдж роли (`admin` / `user`)
- «Выход»
- Для админа — ссылка на `/admin/users` (или дашборд)

## Toast уведомления

`shared/ui/AppToast.vue` используется для:

- сообщений загрузки / старта анализа,
- ошибок квоты,
- сохранений в админке.

::: tip Минимальный, но полезный
При желании можно заменить на `vue-sonner`; текущей очереди достаточно для дипломного UI.
:::
