# Tree-sitter (локальный анализ)

Это самый интересный технический момент VS Code-расширения — **AST-парсер C, который работает прямо внутри Extension Host через WebAssembly**.

## Зачем именно tree-sitter

::: tip Почему не RegExp
RegExp не отличит `arr[i]` в комментарии от настоящего обращения. Не построит дерево вложенности циклов. Не отследит, какая переменная — induction var. Для подсветки реальных паттернов — слишком грубый инструмент.
:::

::: tip Почему не clang/llvm
- clang в браузерном/Node-runtime — десятки мегабайт WASM или нативный binary, которого нет в Extension Host.
- Запускать `clang` через `child_process` из Extension Host — медленно (forked-процесс на каждое нажатие клавиши).
- Нужно отдельно ставить clang на машине пользователя — лишнее требование.
:::

::: tip Почему не серверный round-trip
- Сетевой вызов на каждое сохранение — 50–500ms latency.
- Без сервера расширение становится бесполезно offline.
- Цель локального анализа — **мгновенный feedback**, что несовместимо с network round-trip.
:::

::: tip А tree-sitter
- WASM-бинарник `tree-sitter-c.wasm` ~600KB — приемлемо.
- Парсинг типичной C-функции — 10–50ms.
- Полноценный AST с named children, field-names, position info.
- Работает в Node-runtime extension host без CGO.
:::

## Инициализация

```ts
// src/local/treeSitterAnalyzer.ts
let parser: TSParser | null = null
let initPromise: Promise<void> | null = null

export function initTreeSitter(extensionPath: string): Promise<void> {
  if (initPromise) return initPromise

  initPromise = (async () => {
    const wts = require('web-tree-sitter')
    const ParserClass = wts.Parser ?? wts.default?.Parser ?? wts

    const distDir = path.join(extensionPath, 'dist')
    await ParserClass.init({
      locateFile: (file: string) => path.join(distDir, file),
    })

    const p: TSParser = new ParserClass()
    const LangClass = wts.Language ?? wts.default?.Language ?? ParserClass.Language
    const lang = await LangClass.load(path.join(distDir, 'tree-sitter-c.wasm'))
    p.setLanguage(lang)
    parser = p
  })()
  return initPromise
}
```

::: warning `require('web-tree-sitter')` динамически
- Версии 0.x и 0.20+ имеют разный API (`Parser` vs `default.Parser`). `??` chain аккуратно поддерживает обе.
- `Parser.init({locateFile})` нужен, чтобы найти `tree-sitter.wasm` в `dist/`. Без `locateFile` библиотека ищет по `__dirname` и в Extension Host это иногда указывает не туда.
- `LangClass.load('tree-sitter-c.wasm')` — отдельный WASM с грамматикой C.
:::

## Walker по AST

```ts
function walk(node: TSNode, ctx: Ctx, funcName: string,
              loopDepth: number, loopVars: Set<string>): void {
  if (node.type === 'function_definition') {
    const name = funcDeclName(node.childForFieldName('declarator'))
    const body = node.childForFieldName('body')
    if (body) walk(body, ctx, name || funcName, 0, new Set())
    return
  }

  if (node.type === 'for_statement') {
    const v = extractForVar(node)
    const vars = new Set(loopVars)
    if (v) vars.add(v)
    const body = node.childForFieldName('body')
    if (body) {
      collectSubscripts(body, ctx, funcName, loopDepth + 1, vars)
      walk(body, ctx, funcName, loopDepth + 1, vars)
    }
    return
  }

  if (node.type === 'while_statement' || node.type === 'do_statement') {
    const body = node.childForFieldName('body')
      || node.namedChildren.find((c) => c.type === 'compound_statement')
    if (body) {
      collectSubscripts(body, ctx, funcName, loopDepth + 1, loopVars)
      walk(body, ctx, funcName, loopDepth + 1, loopVars)
    }
    return
  }

  // ... обработка array_subscript_expression, ...
  for (const child of node.namedChildren) {
    walk(child, ctx, funcName, loopDepth, loopVars)
  }
}
```

::: tip Чем отличается от Go-walker-а в worker-static
- **Меньше типов узлов** — мы оптимистично работаем с tree-sitter, который имеет более грубую грамматику, чем clang AST.
- **Loop vars как Set** — собираем имена induction vars из всех окружающих циклов; в worker-static это ровно один (innermost).
- **`loopDepth` без trip count** — мы не оцениваем количество итераций. Это **классификация паттернов**, а не **оценка трафика**.
- **`childForFieldName('body')`** — tree-sitter API для именованных child-полей. Удобнее, чем "n-й ребёнок".
:::

## Обнаружение паттернов

Функция `collectSubscripts` находит все `array_subscript_expression` (`arr[i]`) в теле цикла и классифицирует:

```ts
const indexNode = node.childForFieldName('index')
const arrName   = subjectName(node.childForFieldName('argument'))

if (isLoopVar(indexNode, loopVars)) {
  emit({ ..., patternType: 'unit_stride', severity: 'info' })
} else if (isAffineLoop(indexNode, loopVars)) {
  emit({ ..., patternType: 'non_unit_stride', severity: 'warning' })
} else if (containsArraySubscript(indexNode)) {
  emit({ ..., patternType: 'gather_scatter', severity: 'warning' })
} else {
  emit({ ..., patternType: 'random', severity: 'error' })
}
```

::: info Разница severity
- **info** — просто факт ("здесь есть `unit_stride` доступ"). Зелёный диагностик.
- **warning** — стоит присмотреться (non-unit-stride или indirect).
- **error** — потенциально проблемный паттерн (random access).

Severity threshold (`analyzer.severityThreshold`) определяет, какой минимум показывается в Problems-панели.
:::

## Deduplication

```ts
function deduplicate(entries: AnalysisEntry[]): AnalysisEntry[] {
  const seen = new Set<string>()
  return entries.filter((e) => {
    const key = `${e.line}:${e.column}:${e.patternType}:${e.symbol}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
```

::: tip Зачем
В tree-sitter `arr[i] = arr[j]` — это два разных subscript-узла, каждый из которых walker находит. Без дедупликации одно выражение могло бы дать дубликат паттерна. Ключ `line:col:type:symbol` достаточно уникален для нашей цели.
:::

## Производительность

| Файл | Размер | Парсинг | Walker | Total |
|---|---|---|---|---|
| `hello.c` (10 строк) | 200 байт | <1ms | <1ms | ~5ms |
| `matmul.c` (50 строк) | 1.5 KB | ~5ms | ~3ms | ~15ms |
| `large.c` (500 строк) | 15 KB | ~30ms | ~15ms | ~50ms |

Эти числа покрывают типичные учебные программы. Для гигантских файлов tree-sitter всё ещё быстрый, но debounce 300ms становится критичным.

## Ограничения локального режима

::: warning Что **не** делает локальный анализ
- Не считает trip count.
- Не оценивает реальные cache misses (это динамическая часть, valgrind).
- Не учитывает межфункциональные эффекты.
- Не отличает заведомо мёртвый код от активного.

То, что находит локальный анализ — это **классификация паттернов** для in-editor подсказок. Реальные числа — только в удалённом анализе.
:::
