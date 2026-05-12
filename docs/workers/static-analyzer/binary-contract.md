# Контракт бинаря анализатора

`worker-static-analyzer` ничего не знает про устройство анализатора. Он общается с ним строго через файлы.

## Как воркер вызывает бинарь

`internal/analyzer/analyzer.go`:

```go
cmd := exec.CommandContext(ctx, a.binaryPath, "conf.json", "--quiet")
cmd.Dir = workDir
cmd.Stdout = os.Stdout
cmd.Stderr = os.Stderr
```

Все три условия важны:

- В `workDir` уже скачан исходник `<file>.c` и записан `conf.json`.
- Первый аргумент — `conf.json` (не путь, а **имя в текущей директории**, потому что мы делаем `cd` через `cmd.Dir`).
- `--quiet` — режим без человекочитаемого лога.

После завершения процесса воркер читает `out.json` из той же `workDir` и парсит как `[]model.Pattern`.

## conf.json

```json
{
  "input": "<source>.c",
  "output": "out.json",
  "output_format": "json",
  "analysis": {
    "max_loop_depth": 4,
    "analyze_dependencies": true,
    "analyze_scev": true
  },
  "debug": {
    "verbose": false,
    "dump_loops": false,
    "dump_scev": false,
    "dump_memory": false
  },
  "features": {
    "enable_fingerprint": true,
    "enable_classification": true
  }
}
```

| Поле | Значение |
|---|---|
| `input` | имя `.c` файла в текущей директории |
| `output` | имя выходного JSON (всегда `out.json`) |
| `analysis.max_loop_depth` | максимальная вложенность циклов, которую анализатор разворачивает |
| `analysis.analyze_dependencies` | искать loop-carried зависимости |
| `analysis.analyze_scev` | использовать LLVM Scalar Evolution для классификации индексов |
| `features.enable_fingerprint` | включает поле `pattern_fingerprint` в выходе |
| `features.enable_classification` | включает классификацию `pattern_type` (`unit_stride` / `gather_scatter` / …) |

## out.json — массив `Pattern`

Тип `model.Pattern` в Go:

```go
type Pattern struct {
    AccessKind         string   `json:"access_kind"`
    Affine             bool     `json:"affine"`
    Alignment          *int     `json:"alignment"`
    BaseKind           string   `json:"base_kind"`
    BaseSymbol         string   `json:"base_symbol"`
    Conditional        bool     `json:"conditional"`
    ContiguousBlock    *int     `json:"contiguous_block"`
    Dependence         string   `json:"dependence"`
    Depth              int      `json:"depth"`
    FillFactor         float64  `json:"fill_factor"`
    Function           string   `json:"function"`
    HasIndexedAddr     bool     `json:"has_indexed_addressing"`
    IndexedByMemory    bool     `json:"indexed_by_memory"`
    LoadCount          int      `json:"load_count"`
    PatternFingerprint string   `json:"pattern_fingerprint"`
    PatternSig         string   `json:"pattern_signature"`
    PatternType        string   `json:"pattern_type"`
    SourceColumn       int      `json:"source_column"`
    SourceFile         string   `json:"source_file"`
    SourceLine         int      `json:"source_line"`
    StoreCount         int      `json:"store_count"`
    Stride             *float64 `json:"stride"`
    WorkingSetBytes    int      `json:"working_set_bytes"`
}
```

Пример одной записи (выход анализатора на простой цикл `for (i=0;i<n;i++) a[i] = i*2`):

```json
{
  "access_kind": "store",
  "affine": true,
  "alignment": 4,
  "base_kind": "pointer_arg",
  "base_symbol": "a",
  "conditional": false,
  "contiguous_block": null,
  "dependence": "no-dep",
  "depth": 1,
  "fill_factor": 1,
  "function": "foo",
  "has_indexed_addressing": true,
  "indexed_by_memory": false,
  "load_count": 0,
  "pattern_signature": "k=store|p=unit_stride|s=1|a=1|c=0|m=0|im=0|ia=1",
  "pattern_type": "unit_stride",
  "source_column": 38,
  "source_file": "simple.c",
  "source_line": 2,
  "store_count": 1,
  "stride": 1,
  "working_set_bytes": 0
}
```

## Куда уходит этот JSON

1. Воркер вставляет каждую строку в `analysis_metrics.static_patterns` (см. [Контракты ClickHouse](/contracts/clickhouse)). Все поля кроме `task_id`, `project_id`, `cache_profile_hash`, `artifact_s3_path` берутся из `Pattern` 1:1.
2. Сам JSON сохраняется без изменений в `analysis-artifacts/<task_id>/static-out.json` — фронт может его скачать и показать сырой результат.

## Почему именно такой контракт

- **Полная сериализуемость**. Анализатор и Go-воркер общаются через JSON-файлы; обмена через stdin/stdout/pipes нет — это упрощает отладку (можно после падения посмотреть `conf.json` и `out.json` в `workDir`).
- **Бинарь ничего не знает про Kafka/MinIO/ClickHouse**. Это позволяет вызывать его руками для воспроизведения проблемы:

  ```bash
  docker run --rm -v $PWD:/work -w /work --platform linux/amd64 \
      keplar01/static-analyzer:latest \
      /usr/local/bin/analyzer conf.json --quiet
  cat out.json
  ```

- **Замена реализации без правок воркера**. Любой ELF/PE-бинарь, который читает `conf.json` и пишет `out.json` в том же формате, заменит `keplar01/static-analyzer` без правок Go-кода.
