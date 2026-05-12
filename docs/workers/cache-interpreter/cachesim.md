# Контракт CacheSim

::: warning Свежесть относительно кода репозитория
Раздел ниже описывает **вариант с Wine и PE-бинарием**, а также упрощённый контракт «только stdout». В текущем дереве **`Interpreter.Run`** (`worker-cache-interpreter/internal/interpreter/interpreter.go`) симулятор вызывается как **`<INTERPRETER_BINARY> <basename.c> json`**, поддерживаются **stdout с JSON или текстом**, дополнительно читаются файлы результатов вида `<stem>_result`. См. обзор [worker-cache-interpreter](./index).

:::

`worker-cache-interpreter` исторически общался с симулятором кэша **преимущественно через stdout**.

## Команда

```go
// internal/interpreter/interpreter.go
cmd := exec.Command("wine", i.binaryPath, filepath.Base(sourceFile))
cmd.Dir = filepath.Dir(sourceFile)
cmd.Stdout = &stdout
cmd.Stderr = &stderr
```

| Деталь | Зачем |
|---|---|
| `wine` | `CacheSim.exe` — Windows x86_64 PE; нативно на Linux его не запустить |
| `cmd.Dir` | бинарь читает входной `.c` файл по имени, относительно cwd |
| `filepath.Base(sourceFile)` | вынуждаем относительный путь, иначе wine может неправильно резолвить Z-drive |

## Формат stdout

```
Time is 1.44955

Cache L1
Cache size 32 kB 8-way
Cache line size 64
Cache access: 4003000
Cache hit: 4002812 (write - 1002812 , read - 3000000)
Cache misses: 188 (write - 188 , read - 0)
Missrate: 0.00469648
Cache misses array a: 62 (write - 62 , read - 0)
Cache misses array b: 63 (write - 63 , read - 0)
Cache misses array c: 63 (write - 63 , read - 0)

Cache L2
Cache size 256 kB 8-way
Cache line size 64
Cache access: 188
Cache hit: 0 (write - 0 , read - 0)
Cache misses: 188 (write - 188 , read - 0)
Missrate: 1
Cache misses array a: 62 (write - 62 , read - 0)
...

Memory reads: 188
Memory writes: 188
```

## Регулярки парсера

```go
reTime       = regexp.MustCompile(`Time is ([\d.]+)`)
reCacheLevel = regexp.MustCompile(`^Cache (L[12])$`)
reCacheSize  = regexp.MustCompile(`Cache size (\d+) kB (\d+)-way`)
reLineSize   = regexp.MustCompile(`Cache line size (\d+)`)
reAccess     = regexp.MustCompile(`^Cache access: (\d+)`)
reHit        = regexp.MustCompile(`^Cache hit: (\d+) \(write - (\d+) , read - (\d+)\)`)
reMiss       = regexp.MustCompile(`^Cache misses: (\d+) \(write - (\d+) , read - (\d+)\)`)
reMissRate   = regexp.MustCompile(`^Missrate: ([\d.eE+\-nan]+)`)
reMissArray  = regexp.MustCompile(`^Cache misses array (\w+): (\d+) \(write - (\d+) , read - (\d+)\)`)
reMemReads   = regexp.MustCompile(`^Memory reads: (\d+)`)
reMemWrites  = regexp.MustCompile(`^Memory writes: (\d+)`)
```

`parseOutput` в `internal/interpreter/interpreter.go` идёт построчно через `bufio.Scanner`, держит указатель `currentLevel` (`*CacheLevelSummary`) на блок L1 или L2 и распихивает значения в `model.CacheSimResult`.

::: tip Почему `nan` в regex
В нечётких ситуациях (см. ниже) `CacheSim.exe` печатает `Missrate: nan`. Регулярка явно принимает токены `nan`, чтобы не упасть на парсинге; дальше Go-`strconv.ParseFloat` корректно вернёт `math.NaN()`.

В JSON-артефакте такое значение даст ошибку `json: unsupported value: NaN`, поэтому ключевая защита — не дать `CacheSim.exe` вернуть `nan` (см. `entrypoint.sh` про прогрев wine).
:::

## Структура результата

```go
type CacheSimResult struct {
    SourceFile   string             `json:"source_file"`
    SimTimeSec   float64            `json:"sim_time_sec"`
    L1           CacheLevelSummary  `json:"l1"`
    L2           CacheLevelSummary  `json:"l2"`
    Arrays       []ArrayCacheMetric `json:"arrays"`
    MemoryReads  uint64             `json:"memory_reads"`
    MemoryWrites uint64             `json:"memory_writes"`
}

type CacheLevelSummary struct {
    CacheLevel    string  `json:"cache_level"`
    CacheSizeKB   uint32  `json:"cache_size_kb"`
    CacheLineSize uint32  `json:"cache_line_size"`
    Associativity uint8   `json:"associativity"`
    TotalAccesses uint64  `json:"total_accesses"`
    TotalHits     uint64  `json:"total_hits"`
    TotalMisses   uint64  `json:"total_misses"`
    HitsRead      uint64  `json:"hits_read"`
    HitsWrite     uint64  `json:"hits_write"`
    MissesRead    uint64  `json:"misses_read"`
    MissesWrite   uint64  `json:"misses_write"`
    MissRate      float64 `json:"miss_rate"`
}

type ArrayCacheMetric struct {
    CacheLevel  string `json:"cache_level"`
    ArrayName   string `json:"array_name"`
    MissesTotal uint64 `json:"misses_total"`
    MissesRead  uint64 `json:"misses_read"`
    MissesWrite uint64 `json:"misses_write"`
}
```

После сериализации этот объект сохраняется в MinIO как `cache-out.json`.

## Что делает `analysis-api-service` с этим JSON

После `events.analysis.cache_completed{status:success}` API-сервис:

1. Скачивает `cache-out.json` из MinIO.
2. Поднимает соответствующие `static_patterns` по `task_id`.
3. JOIN-ит `arrays[*]` (по `array_name`) с `static_patterns` (по `base_symbol`).
4. Пишет получившиеся строки в `analysis_metrics.dynamic_pattern_metrics` (по две на массив: L1 и L2 уровни).

Воркер сам никогда не дёргает ClickHouse.

## Ограничения парсера C-кода в `CacheSim.exe`

`CacheSim.exe` — это симулятор учебного назначения. Его парсер C сильно урезанный. На практике это значит, что не каждый валидный с точки зрения GCC/Clang `.c` файл анализируется.

::: warning Поддерживается только подмножество C
Тестирование показало, что парсер реагирует только на простые формы:

- объявления **одной переменной** на строку (`int a[1000];`, не `int a[1000], b[1000];`),
- **одномерные массивы** (`int a[N];`, не `int a[N][N]`),
- простые `for`-циклы вида `for (i = 0; i < N; i = i + 1)`,
- арифметика с одной переменной за раз (`a[i] = a[i] + b[i];`).

Если бинарь не нашёл ни одного доступа в файле, он печатает блок с `Cache access: 0`, `Missrate: nan` и пустым списком массивов. Воркер видит это, отдаёт результат как `success`, но в `cache-out.json` будут пустые массивы и `nan` в `miss_rate`.
:::

::: info Тестовые файлы
В `worker-cache-interpreter/testdata/` лежат два примера:

- `simple_loop.c` — корректно парсится, даёт ненулевые метрики.
- `matrix_mult.c` — содержит `int a[100][100]`, парсер это не понимает, на выходе пустые массивы.

Если новые `.c` файлы дают `nan`, в первую очередь стоит подгонять синтаксис под `simple_loop.c`.
:::
