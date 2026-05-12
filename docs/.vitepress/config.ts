import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

/** Базовый URL сайта: `/` для автономного деплоя, `/docs/` когда доки за nginx-gateway платформы. */
function vitepressBase(): string {
  const raw = (process.env.VITEPRESS_BASE || '').trim()
  if (!raw || raw === '/') return '/'
  return raw.endsWith('/') ? raw : `${raw}/`
}

export default withMermaid(
  defineConfig({
    lang: 'ru-RU',
    title: 'Diploma Platform Docs',
    description:
      'Единая техническая документация платформы статического и динамического анализа C-кода',
    lastUpdated: true,
    cleanUrls: true,
    base: vitepressBase(),

    head: [
      ['meta', { name: 'theme-color', content: '#3c63b8' }],
      ['meta', { name: 'og:title', content: 'Diploma Platform Docs' }],
    ],

    themeConfig: {
      siteTitle: 'Diploma Docs',
      outline: { level: [2, 3], label: 'На странице' },
      docFooter: { prev: 'Назад', next: 'Далее' },
      lastUpdatedText: 'Обновлено',
      darkModeSwitchLabel: 'Тема',
      sidebarMenuLabel: 'Меню',
      returnToTopLabel: 'Наверх',
      externalLinkIcon: true,

      search: {
        provider: 'local',
        options: {
          locales: {
            root: {
              translations: {
                button: { buttonText: 'Поиск', buttonAriaLabel: 'Поиск' },
                modal: {
                  noResultsText: 'Нет результатов',
                  resetButtonTitle: 'Сбросить',
                  footer: {
                    selectText: 'выбрать',
                    navigateText: 'переходы',
                    closeText: 'закрыть',
                  },
                },
              },
            },
          },
        },
      },

      nav: [
        { text: 'Главная', link: '/' },
        { text: 'Архитектура', link: '/architecture/' },
        { text: 'Инфраструктура', link: '/infrastructure/' },
        {
          text: 'Сервисы',
          items: [
            { text: 'Core API', link: '/backend/core-api/' },
            { text: 'Analysis API', link: '/backend/analysis-api/' },
            { text: 'Worker Static', link: '/workers/static-analyzer/' },
            { text: 'Worker Cache', link: '/workers/cache-interpreter/' },
            { text: 'Frontend', link: '/clients/frontend/' },
            { text: 'VS Code Extension', link: '/clients/vscode/' },
          ],
        },
        { text: 'Контракты', link: '/contracts/' },
      ],

      sidebar: {
        '/': [
          {
            text: '🏛 Архитектура',
            collapsed: false,
            items: [
              { text: 'Обзор системы', link: '/architecture/' },
              { text: 'Event-driven поток', link: '/architecture/event-flow' },
              { text: 'Состояние задачи (FSM)', link: '/architecture/task-lifecycle' },
              { text: 'Глобальные принципы', link: '/architecture/principles' },
            ],
          },
          {
            text: '🧱 Инфраструктура',
            collapsed: false,
            items: [
              { text: 'Обзор', link: '/infrastructure/' },
              { text: 'Docker Compose', link: '/infrastructure/docker-compose' },
              { text: 'PostgreSQL', link: '/infrastructure/postgres' },
              { text: 'ClickHouse', link: '/infrastructure/clickhouse' },
              { text: 'MinIO (S3)', link: '/infrastructure/minio' },
              { text: 'Kafka', link: '/infrastructure/kafka' },
              { text: 'Redis', link: '/infrastructure/redis' },
              { text: 'Nginx Gateway', link: '/infrastructure/nginx' },
            ],
          },
          {
            text: '🟦 Backend',
            collapsed: false,
            items: [
              {
                text: 'Core API',
                collapsed: false,
                items: [
                  { text: 'Overview', link: '/backend/core-api/' },
                  { text: 'Стек и конфигурация', link: '/backend/core-api/config' },
                  { text: 'Модель данных', link: '/backend/core-api/data-model' },
                  { text: 'Структура кода', link: '/backend/core-api/architecture' },
                  { text: 'JWT и middleware', link: '/backend/core-api/auth' },
                  { text: 'Sequence: login', link: '/backend/core-api/flow' },
                  { text: 'HTTP API', link: '/backend/core-api/api' },
                ],
              },
              {
                text: 'Analysis API',
                collapsed: false,
                items: [
                  { text: 'Overview', link: '/backend/analysis-api/' },
                  { text: 'Стек и конфигурация', link: '/backend/analysis-api/config' },
                  { text: 'Модель данных', link: '/backend/analysis-api/data-model' },
                  { text: 'Структура кода', link: '/backend/analysis-api/architecture' },
                  { text: 'Оркестрация задач', link: '/backend/analysis-api/orchestration' },
                  { text: 'Квоты (Redis)', link: '/backend/analysis-api/quotas' },
                  { text: 'Метрики (ClickHouse)', link: '/backend/analysis-api/metrics' },
                  { text: 'Sequence: upload→done', link: '/backend/analysis-api/flow' },
                  { text: 'HTTP API', link: '/backend/analysis-api/api' },
                ],
              },
            ],
          },
          {
            text: '🟪 Workers',
            collapsed: false,
            items: [
              {
                text: 'Worker Static Analyzer',
                collapsed: false,
                items: [
                  { text: 'Overview', link: '/workers/static-analyzer/' },
                  { text: 'Стек и конфигурация', link: '/workers/static-analyzer/config' },
                  { text: 'Структура кода', link: '/workers/static-analyzer/architecture' },
                  { text: 'Контракт бинаря', link: '/workers/static-analyzer/binary-contract' },
                  { text: 'Sequence', link: '/workers/static-analyzer/flow' },
                ],
              },
              {
                text: 'Worker Cache Interpreter',
                collapsed: false,
                items: [
                  { text: 'Overview', link: '/workers/cache-interpreter/' },
                  { text: 'Стек и конфигурация', link: '/workers/cache-interpreter/config' },
                  { text: 'Структура кода', link: '/workers/cache-interpreter/architecture' },
                  { text: 'Контракт CacheSim', link: '/workers/cache-interpreter/cachesim' },
                  { text: 'Sequence', link: '/workers/cache-interpreter/flow' },
                ],
              },
            ],
          },
          {
            text: '🟩 Clients',
            collapsed: false,
            items: [
              {
                text: 'Frontend (Vue 3)',
                collapsed: false,
                items: [
                  { text: 'Overview', link: '/clients/frontend/' },
                  { text: 'Стек и конфигурация', link: '/clients/frontend/config' },
                  { text: 'Архитектура (FSD)', link: '/clients/frontend/architecture' },
                  { text: 'Стейт (Pinia)', link: '/clients/frontend/state' },
                  { text: 'Polling & Monaco', link: '/clients/frontend/integrations' },
                  { text: 'UI Screens', link: '/clients/frontend/screens' },
                ],
              },
              {
                text: 'VS Code Extension',
                collapsed: false,
                items: [
                  { text: 'Overview', link: '/clients/vscode/' },
                  { text: 'Стек и конфигурация', link: '/clients/vscode/config' },
                  { text: 'Архитектура расширения', link: '/clients/vscode/architecture' },
                  { text: 'Tree-sitter (локально)', link: '/clients/vscode/tree-sitter' },
                  { text: 'Providers (UX)', link: '/clients/vscode/providers' },
                  { text: 'UI / мокапы экрана', link: '/clients/vscode/screens' },
                  { text: 'Sequence: in-editor', link: '/clients/vscode/flow' },
                ],
              },
            ],
          },
          {
            text: '📜 Контракты',
            collapsed: false,
            items: [
              { text: 'Обзор', link: '/contracts/' },
              { text: 'Kafka events', link: '/contracts/kafka' },
              { text: 'HTTP API Reference', link: '/contracts/http' },
              { text: 'ClickHouse schema', link: '/contracts/clickhouse' },
              { text: 'Общие модели данных', link: '/contracts/types' },
            ],
          },
        ],
      },

      socialLinks: [
        { icon: 'github', link: 'https://github.com/' },
      ],

      footer: {
        message: 'Документация платформы анализа C-кода',
        copyright: '© 2026 Diploma Project',
      },
    },

    mermaid: {
      theme: 'default',
      securityLevel: 'loose',
    },

    markdown: {
      lineNumbers: true,
      theme: { light: 'github-light', dark: 'github-dark' },
    },
  }),
)
