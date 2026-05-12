# Метрики задачи (`GET /tasks/:task_id/metrics`)

Ответ **`MetricsResponse`** строится в `AnalysisUseCase.ComputeTaskMetrics`: источник — **JSON-артефакт симулятора** в MinIO (`cache-out.json` по пути `cache_artifact_s3_path` задачи в PostgreSQL), а не агрегат ClickHouse «на лету».

Если кэш-стадия не выполнена или файл недоступен, поля остаются нулевыми, в JSON уходит только `task_id` и текущий `status`.

## Public response

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

## Реализация (упрощённо)

После успешной кэш-стадии API скачивает `cache-out.json` и парсит его в `CacheSimResult`. **Базой для заголовков UI** считается сводка **L1**:

- `total_memory_accesses` ← `raw.L1.TotalAccesses`
- `cache_hits` ← `raw.L1.TotalHits`
- `cache_misses` ← `raw.L1.TotalMisses`
- при `TotalAccesses > 0`: `hit_rate` и `miss_rate` — доли по полям выше.

**Оценка оптимизации** `optimization_score` (0…100):

- до **90 баллов** — доля попаданий в **L1** (`TotalHits / TotalAccesses × 90`);
- до **+10 баллов** — доля попаданий в **L2** (`TotalHits / TotalAccesses × 10` для слоя L2);
- результат ограничен сверху 100.

См. `computeOptimizationScore` в `analysis-api-service/internal/usecase/analysis_usecase.go`.

::: tip Связь с ClickHouse
Per-array промахи и JOIN со статикой живут в `dynamic_pattern_metrics` и используются для **`GET /tasks/:task_id/aggregated`**. Отдельно от этого **метрики «в одну строку» для карточек** берутся именно из L1 блока **`cache-out.json`**.
:::

## Топ паттернов для админки

`GET /analysis/admin/patterns/top` по-прежнему агрегирует типы паттернов по таблице **`static_patterns`** в ClickHouse (`COUNT(*) GROUP BY pattern_type`). Это **не то же самое**, что headline-метрики задачи из `cache-out.json`.

```go
SELECT pattern_type, COUNT(*) AS cnt
FROM analysis_metrics.static_patterns
GROUP BY pattern_type
ORDER BY cnt DESC
LIMIT ?
```

Подробнее о схеме — в [ClickHouse](/contracts/clickhouse).
