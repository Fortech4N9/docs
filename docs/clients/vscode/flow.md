# Sequence: in-editor flow

Эта страница соединяет два сценария — local-analysis и remote-analysis — в одной картине.

## Local analysis (на каждое сохранение)

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant ED as VS Code Editor
    participant EXT as extension.ts
    participant TS as treeSitterAnalyzer
    participant Prov as Providers

    U->>ED: правит .c файл
    ED->>EXT: onDidChangeTextDocument
    EXT->>EXT: debounce(800ms)
    EXT->>TS: analyzeLocally(source, fileName)
    TS->>TS: parser.parse(source)
    TS->>TS: walk → AnalysisEntry[]
    TS-->>EXT: entries
    EXT->>Prov: decorations.apply, diagnostics.apply,<br/>hover.setResults, codelens.setResults
    Prov->>ED: подсветка строк, Problems-панель,<br/>hover, code lens
```

## Remote analysis (команда «Анализатор: запустить анализ на сервере»)

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant ED as Editor
    participant EXT as extension.ts
    participant API as ApiClient
    participant VSAuth as vscode.authentication
    participant CORE as core-api
    participant ANA as analysis-api
    participant Pipe as Workers
    participant Panel as ReportPanel
    participant Prov as Providers

    U->>ED: палитра команд / статус-бар
    ED->>EXT: analyzer.runAnalysis
    EXT->>API: ensureAuthenticated()
    alt нет связки аккаунт VS Code → JWT платформы
      API->>VSAuth: getSession('github', silent=true)
      VSAuth-->>API: session{email}
      API->>CORE: POST /auth/login
      CORE-->>API: {token}
      API->>API: SecretStorage сохраняет analyzer_token
    end

    EXT->>API: uploadCurrentFile(...)
    API->>ANA: POST /analysis/upload
    ANA-->>API: 202 + задача
    Note over Pipe: static + cache workers, см. [event-flow](/architecture/event-flow)

    loop поллинг до done или error
      EXT->>API: getTaskStatus
      API->>ANA: GET /tasks/:id
      ANA-->>EXT: задача + error_message, reused_from_task_id (если есть)
    end

    EXT->>API: сбор bundle: метрики + aggregated, при необходимости static-patterns
    EXT->>Panel: ReportPanel.showServerReport(bundle)
    EXT->>Prov: applyServerResultToEditor
```

## Что происходит при ошибках

```mermaid
sequenceDiagram
    actor U as User
    participant EXT as extension.ts
    participant API as ApiClient
    participant ANA as analysis-api

    EXT->>API: uploadCurrentFile(...)
    alt 401 истекла сессия
      API->>EXT: ошибка авторизации / logout
      EXT->>U: предложение запустить анализ заново

    else 429 квота
      API-->>EXT: 429 Too Many Requests
      EXT->>U: сообщение об исчерпании дневной квоты

    else 500
      API-->>EXT: ошибка сервера
      EXT->>U: текст ошибки в уведомлении
    end

    EXT->>API: getTaskStatus(...)
    alt task.status == error
      EXT->>U: текст error_message или запасное сообщение, кнопка «Показать отчёт»
      EXT->>EXT: webview всё равно может содержать статические паттерны
    end
```

## Состояние status bar

```mermaid
stateDiagram-v2
    [*] --> Loading: extension activate
    Loading --> Anonymous: нет сохранённого JWT
    Loading --> Authenticated: токен из Secret Storage
    Anonymous --> Authenticated: успешный ensureAuthenticated()
    Authenticated --> Analyzing: удалённый анализ запущен
    Analyzing --> Authenticated: задача успешно завершена
    Analyzing --> Error: ошибка задачи или сети
    Error --> Authenticated: сброс подсветки / новый запуск
    Authenticated --> Anonymous: analyzer.logout
    Anonymous --> [*]
```

Текст в статусбаре по реализации:

- после инициализации Tree-sitter: `Анализатор (TS готов)`;
- при входе на платформу: `Анализатор: email@…`;
- до входа — `Анализатор`; прогресс серверного запроса показывает **глобальный progress** VS Code со статусом задачи на русском.

## Жизнь decorations при смене editor

```mermaid
sequenceDiagram
    actor U as User
    participant ED as Editor
    participant DM as DecorationManager

    Note over DM: lastResults сохранены глобально

    U->>ED: открывает file2.c
    ED->>DM: onDidChangeActiveTextEditor
    DM->>DM: clearAll on previous editor
    alt file2 в lastResults
      DM->>ED: apply на file2
    else
      Note right of DM: при autoLocalAnalysis=true<br/>extension сам перезапустит analyzeLocally
    end
```

::: tip Почему такой подход
- Декорации не "переживают" между файлами автоматически — VS Code привязывает их к конкретному editor-у.
- Расширение само заново применяет результаты при смене активного editor-а, чтобы пользователь не терял подсветку.
:::
