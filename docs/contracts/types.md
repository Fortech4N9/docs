# Общие модели данных

Структуры, которые "путешествуют" между сервисами через JSON. Каждая структура определена в своём сервисе, но семантика одна.

## Kafka events

### `StartAnalysisEvent`

```go
// Используется и в analysis-api, и в обоих воркерах
type StartAnalysisEvent struct {
    TaskID     string `json:"task_id"`
    ProjectID  string `json:"project_id"`
    FileS3Path string `json:"file_s3_path"`
}
```

Применяется в `events.analysis.start_static` и `events.analysis.start_cache`.

### `AnalysisCompletedEvent`

```go
type AnalysisCompletedEvent struct {
    TaskID         string `json:"task_id"`
    ProjectID      string `json:"project_id,omitempty"`
    Status         string `json:"status"`             // "success" | "error"
    ArtifactS3Path string `json:"artifact_s3_path,omitempty"`
    Error          string `json:"error,omitempty"`
}
```

Применяется в `events.analysis.static_completed` и `events.analysis.cache_completed`.

::: warning Структура продублирована
Каждый воркер объявляет свои `StartEvent` / `CompletedEvent` локально (в `cmd/main.go`):

```go
// worker-static-analyzer/cmd/main.go
type StartEvent struct {
    TaskID     string `json:"task_id"`
    ProjectID  string `json:"project_id"`
    FileS3Path string `json:"file_s3_path"`
}
```

Это **сознательный** компромисс — не хочется делать общий go-модуль с типами, потому что это создаст deployment-связку между сервисами. JSON-тэги совпадают по convention, что и даёт wire-совместимость.

Для большой платформы это решение пересмотрят — общая schema-registry (Avro/Protobuf) сделает контракт более явным.
:::

## ClickHouse rows

### `Pattern` (static_patterns)

```go
// worker-static-analyzer/internal/analyzer/types.go
type Pattern struct {
    TaskID, ProjectID  string
    SourceFile         string
    SourceLine, SourceColumn uint32
    Function           string
    BaseSymbol         string
    BaseKind           string   // array|pointer|scalar
    AccessKind         string   // load|store
    PatternType        string   // unit_stride|non_unit_stride|gather_scatter|constant|random
    PatternFingerprint string
    Affine             uint8
    Stride             *float64
    Depth              uint8
    HasIndexedAddr     uint8
    IndexedByMemory    uint8
    Conditional        uint8
    FillFactor         float64
    Alignment          *uint32
    WorkingSetBytes    uint64
    Dependence         string
    PatternSignature   string
    ContiguousBlock    *uint32
    LoadCount, StoreCount uint32
    CacheProfileHash   string
    ArtifactS3Path     string
}
```

### `DynamicMetric` (dynamic_pattern_metrics)

```go
// worker-cache-interpreter/internal/cachepipeline/types.go
type DynamicMetric struct {
    PatternFingerprint string
    BaseSymbol         string
    AccessKind         string
    CacheProfileHash   string
    CacheLevel         string  // L1|LL
    MissesTotal        uint64
    MissesRead         uint64
    MissesWrite        uint64
    SourceTaskID       string
    SourceFile         string
    InterpreterVersion string
}
```

## Domain models (Go)

### `User` (core-api)

```go
type User struct {
    ID            string    `json:"id"`
    Email         string    `json:"email"`
    PasswordHash  string    `json:"-"`        // не уходит наружу
    Role          string    `json:"role"`     // user|admin
    AnalysisQuota int       `json:"analysis_quota"`
    IsActive      bool      `json:"is_active"`
    CreatedAt     time.Time `json:"created_at"`
}
```

### `Project` (core-api)

```go
type Project struct {
    ID        string    `json:"id"`
    UserID    string    `json:"user_id"`
    Name      string    `json:"name"`
    CreatedAt time.Time `json:"created_at"`
}
```

### `File` (analysis-api)

```go
type File struct {
    ID        string    `json:"id"`
    ProjectID string    `json:"project_id"`
    Filename  string    `json:"filename"`
    S3Path    string    `json:"s3_path"`
    CreatedAt time.Time `json:"created_at"`
}
```

### `AnalysisTask` (analysis-api)

```go
type AnalysisTask struct {
    ID        string    `json:"id"`
    FileID    string    `json:"file_id"`
    Status    string    `json:"status"`
    Type      string    `json:"type"`
    CreatedAt time.Time `json:"created_at"`
    UpdatedAt time.Time `json:"updated_at"`
}
```

### `MetricsResponse` (analysis-api → клиенты)

```go
type MetricsResponse struct {
    TaskID            string  `json:"task_id"`
    Status            string  `json:"status"`
    TotalMemoryAccess uint64  `json:"total_memory_accesses"`
    CacheHits         uint64  `json:"cache_hits"`
    CacheMisses       uint64  `json:"cache_misses"`
    HitRate           float64 `json:"hit_rate"`
    MissRate          float64 `json:"miss_rate"`
    OptimizationScore float64 `json:"optimization_score"`
}
```

## Frontend (TypeScript) — параллельные типы

```ts
// src/entities/analysis/model/types.ts
export type TaskStatus =
  | 'pending'
  | 'static_running'
  | 'static_done'
  | 'cache_running'
  | 'done'
  | 'error'

export interface AnalysisTask {
  id: string
  file_id: string
  status: TaskStatus
  type: string
  created_at: string
  updated_at: string
}

export interface AnalysisMetrics {
  task_id: string
  status: TaskStatus
  total_memory_accesses: number
  cache_hits: number
  cache_misses: number
  hit_rate: number
  miss_rate: number
  optimization_score: number
}
```

::: warning Дублирование контракта
Структуры в `entities/*/types.ts` пишутся вручную и должны держаться в синхроне с Go-моделями. Это типичная боль hand-rolled type-systems в полиглотном проекте.

Возможные решения:

- **OpenAPI codegen** — описать API в `openapi.yaml`, и генерировать TS-типы и Go-структуры.
- **Shared protobuf** — точно тот же подход, но через protoc-gen-ts / protoc-gen-go.
- Сейчас ни того, ни другого не делается — экономия в долгом терме оплачивается несинхронизацией. Для следующего поколения — рекомендую.
:::

## VS Code (TypeScript)

```ts
// diploma-vscode/src/types.ts
export type Severity = 'info' | 'warning' | 'error'
export type PatternType =
  | 'unit_stride' | 'non_unit_stride'
  | 'gather_scatter' | 'constant' | 'random'

export interface AnalysisEntry {
  line: number
  column: number
  function: string
  symbol: string
  patternType: PatternType
  severity: Severity
  message: string
  loopDepth: number
  conditional: boolean
}

export interface AnalysisTask {
  id: string
  file_id: string
  status: TaskStatus
  type: string
  created_at: string
  updated_at: string
}

export interface AnalysisMetrics extends MetricsResponse { /* ... */ }
```

`AnalysisEntry` уникален для VS Code — это локальный контракт между `treeSitterAnalyzer` и провайдерами.

## Кратко: где что лежит

| Контракт | Файл |
|---|---|
| `StartAnalysisEvent` | `analysis-api/internal/model/models.go` |
| `AnalysisCompletedEvent` | `analysis-api/internal/model/models.go` |
| `Pattern` | `worker-static-analyzer/internal/analyzer/types.go` |
| `DynamicMetric` | `worker-cache-interpreter/internal/cachepipeline/types.go` |
| `User`, `Project`, admin DTO | `core-api-service/internal/model/*.go` |
| `File`, `AnalysisTask`, `MetricsResponse` | `analysis-api-service/internal/model/models.go` |
| Frontend types | `diploma-frontend/src/entities/*/model/types.ts` |
| VS Code types | `diploma-vscode/src/types.ts` |
