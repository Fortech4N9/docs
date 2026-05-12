# Стек и конфигурация — Frontend

## Технологический стек

| Категория | Технология | Версия |
|---|---|---|
| Framework | Vue | 3.5 |
| Сборщик | Vite | 8 |
| Язык | TypeScript | 6 |
| State | Pinia | 3 |
| Routing | Vue Router | 4 |
| HTTP | Axios | 1.15 |
| UI styles | Tailwind CSS | 4 |
| Графики | Chart.js + vue-chartjs | 4 / 5 |
| Editor | Monaco Editor (`@guolao/vue-monaco-editor`) | 1.6 |
| Splitpanes | `splitpanes` | 4 |
| Иконки | `lucide-vue-next` | 1 |

::: tip Почему Vue 3 + Vite, а не React/Next
- **Composition API + `<script setup>`** очень компактный по сравнению с React hooks для типичной CRUD-задачи.
- **Vite** даёт нам холодный старт за 200 ms и HMR за <50 ms — критично для UX разработчика.
- Команды бэкенда читают Vue-код как обычный TS — нет magic React conventions.
:::

## Переменные окружения

| Переменная | Дефолт | Назначение |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | Базовый URL API для axios |

::: info Почему path-based, а не URL
В docker-сборке клиент работает на том же origin, что и API (через nginx-proxy). `'/api/v1'` — относительный путь, поэтому никаких CORS, никакой завязки на конкретный домен.
:::

## Build & Run

### Dev

```bash
npm install
npm run dev
# открыть http://localhost:5173
# vite сам прокидывает API на /api/v1 (нужен запущенный nginx или ручной proxy в vite.config)
```

### Production

```bash
npm run build         # vue-tsc -b && vite build → dist/
npm run preview       # локальный preview production-сборки
```

## Dockerfile

```dockerfile
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build

FROM nginx:1.25-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

::: tip python3/make/g++ в builder
Некоторые npm-пакеты (нативные модули типа `node-gyp`) требуют сборки. Для надёжной production-сборки заранее ставим тулчейн.
:::

## Конфиг axios

```ts
// src/shared/api/instance.ts
import axios from 'axios'
import router from '@/app/router'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      router.push('/login')
    }
    return Promise.reject(err)
  },
)
```

::: tip Что здесь полезного
- **Глобальный 401-хендлер** — токен мог протухнуть; автоматически чистим и редирект на логин.
- **localStorage** для токена — XSS-стойкость можно усилить переходом на httpOnly cookie, но в demo-среде мы выбрали простой UX.
- **30 секунд timeout** — достаточно для обычных API; для file-upload axios сам переопределяет на больший лимит при необходимости.
:::

## Tailwind 4

В `vite.config.ts`:

```ts
import tailwind from '@tailwindcss/vite'
export default defineConfig({ plugins: [vue(), tailwind()] })
```

Tailwind 4 настраивается через `@theme` директиву в CSS — без отдельного `tailwind.config.js`. Это удобно: тема живёт там же, где она применяется.
