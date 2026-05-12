# Оркестрация задач

::: info Самый важный раздел analysis-api
Здесь описывается, как именно живёт одна задача: переходы FSM, защита от гонок, транзакционность Postgres + Kafka, и почему оркестрация написана именно так.
:::

## Use-case `UploadAndAnalyze` (старт пайплайна)

Расположен в `internal/usecase/analysis_usecase.go`. Делает строгую последовательность:

```go
func (uc *AnalysisUseCase) UploadAndAnalyze(
    ctx context.Context, userID string, quota int,
    projectID, filename string, fileReader io.Reader, fileSize int64,
) (*model.AnalysisTask, error) {

    // 1) Atomic quota check — INCR в Redis с TTL 24h
    if err := uc.consumeQuota(ctx, userID, quota); err != nil {
        return nil, err            // 429 при ErrQuotaExceeded
    }

    fileID := uuid.New().String()
    taskID := uuid.New().String()
    s3Path := fmt.Sprintf("%s/%s%s", projectID, fileID, filepath.Ext(filename))

    // 2) Сохраняем файл в MinIO (.c → source-codes/<project>/<file>.c)
    if err := uc.minio.Upload(ctx, storage.BucketSourceCodes, s3Path,
                              fileReader, fileSize, "text/x-csrc"); err != nil {
        return nil, fmt.Errorf("minio upload: %w", err)
    }

    // 3) Записываем file и task в Postgres
    file := &model.File{ID: fileID, ProjectID: projectID, ...,
        S3Path: storage.BucketSourceCodes + "/" + s3Path}
    if err := uc.repo.CreateFile(ctx, file); err != nil { ... }

    task := &model.AnalysisTask{ID: taskID, FileID: fileID,
        Status: model.StatusPending, Type: "full_analysis", ...}
    if err := uc.repo.CreateTask(ctx, task); err != nil { ... }

    // 4) Переключаем FSM в БД ДО Kafka
    if err := uc.repo.UpdateTaskStatus(ctx, taskID, model.StatusStaticRun); err != nil { ... }
    task.Status = model.StatusStaticRun

    // 5) Публикуем событие — последний шаг
    event := model.StartAnalysisEvent{
        TaskID: taskID, ProjectID: projectID, FileS3Path: file.S3Path,
    }
    if err := uc.producer.Publish(ctx, kafka.TopicStartStatic, taskID, event); err != nil {
        return nil, fmt.Errorf("kafka publish: %w", err)
    }
    return task, nil
}
```

## Почему именно такой порядок

::: tip 6 ключевых решений
**1. Quota check — первый шаг.** Если квота исчерпана — никакого ввода-вывода в MinIO/Kafka. Дешевле всего отказать пораньше.

**2. MinIO до Postgres.** Файл должен быть доступен для воркера в момент, когда воркер прочтёт сообщение. Если бы мы сначала писали task в БД, а потом загружали в MinIO, и МиниO упал — задача "висела бы" со статусом pending без артефакта.

**3. Postgres до Kafka.** Запись в БД создаёт state, который мы можем восстановить. Если же мы продьюсим в Kafka до записи в БД, и БД упадёт — у воркера будет task_id, по которому в БД нет ничего.

**4. UPDATE status до publish.** Когда воркер уже потребляет сообщение, в БД задача должна быть в `static_running`. Иначе возможна гонка: воркер читает task в pending, не понимает, что ему делать, и работает по локальной интуиции.

**5. INCR Redis — атомарный.** `INCR` возвращает абсолютное значение, мы сразу видим "11-й" — ничего не нужно сравнивать с уровнем "до".

**6. Kafka publish — RequireAll.** Producer не вернёт OK, пока сообщение не реплицируется на все ISR. В dev-сборке это эквивалентно "записал на лидера", в production-сборке (RF=3) гарантирует durability.
:::

::: warning Где могут быть проблемы
- **Между MinIO upload и INSERT files.** Если MinIO принял файл, но Postgres упал — в S3 останется "мусорный" объект, на который никто не сошлётся. Это **acceptable trash**: он не мешает, и периодический GC может его подобрать.
- **Между INSERT tasks и UPDATE status=static_running.** Сейчас два отдельных запроса. Можно было бы объединить через `INSERT ... RETURNING` со status сразу `static_running`, но логически это тот же эффект.
- **Между UPDATE и Kafka.publish.** Если Kafka недоступен, БД останется в `static_running` без события. Очистка такого "висящего" состояния сейчас ручная (`UPDATE ... SET status='error'`).
:::

## Kafka Producer (настройки)

```go
// internal/kafka/producer.go
w := &kafkago.Writer{
    Addr:         kafkago.TCP(brokers),
    Balancer:     &kafkago.LeastBytes{},
    RequiredAcks: kafkago.RequireAll,
}
```

::: tip
- `LeastBytes` — балансировка по партициям; пишет в ту, у которой меньше всего bytes pending. Для нашего объёма не критично, но даёт равномерное распределение, когда партиций больше одной.
- `RequireAll` — strong durability при RF>1. С RF=1 поведение эквивалентно `RequireOne`.
- Передаём `key = task_id` — все события одной задачи попадают в одну партицию (важно для будущего HA-кластера).
:::

## Kafka Consumer (FSM-переходы)

```go
// internal/kafka/consumer.go
func (c *Consumer) StartListening(ctx context.Context) {
    go c.listenTopic(ctx, TopicStaticCompleted, c.handleStaticCompleted)
    go c.listenTopic(ctx, TopicCacheCompleted,  c.handleCacheCompleted)
}
```

### `handleStaticCompleted`

```go
func (c *Consumer) handleStaticCompleted(ctx, data) error {
    var event model.AnalysisCompletedEvent
    json.Unmarshal(data, &event)

    if event.Status == "success" {
        c.repo.UpdateTaskStatus(ctx, event.TaskID, model.StatusStaticDone)

        task, _ := c.repo.GetTaskByID(ctx, event.TaskID)
        file, _ := c.repo.GetFileByID(ctx, task.FileID)

        c.repo.UpdateTaskStatus(ctx, event.TaskID, model.StatusCacheRun)

        startEvent := model.StartAnalysisEvent{
            TaskID:     event.TaskID,
            ProjectID:  file.ProjectID,
            FileS3Path: file.S3Path,
        }
        return c.producer.Publish(ctx, TopicStartCache, event.TaskID, startEvent)
    }
    return c.repo.UpdateTaskStatus(ctx, event.TaskID, model.StatusError)
}
```

::: info Двойной UPDATE в одном handler
`static_done` появляется на пол-секунды между двумя UPDATE-ами. Это намеренно — два разных события FSM:

- "статический анализ завершён успешно" (`static_done`),
- "запущен следующий шаг" (`cache_running`).

Если в этот момент пользователь дёрнет `GET /tasks/:id` — он увидит один из этих статусов. Оба валидны.
:::

::: warning Reader config: `StartOffset: LastOffset`
В config-е reader-а указано `StartOffset: kafkago.LastOffset` — на старте сервис читает только **новые** сообщения. Если analysis-api долго лежал, и за это время пришло 100 `static_completed` — после рестарта он их **не догребёт**.

Это компромисс ради простоты: при downtime API задачи остаются в `static_running` и помечаются ручным "rerun". Решается переходом на committed offset, но требует осознанного коммита после `UpdateTaskStatus`.
:::

### `handleCacheCompleted`

```go
func (c *Consumer) handleCacheCompleted(ctx, data) error {
    var event model.AnalysisCompletedEvent
    json.Unmarshal(data, &event)

    if event.Status == "success" {
        return c.repo.UpdateTaskStatus(ctx, event.TaskID, model.StatusDone)
    }
    return c.repo.UpdateTaskStatus(ctx, event.TaskID, model.StatusError)
}
```

Простой terminal-переход.

## Защита от гонок

| Гонка | Защита |
|---|---|
| Два воркера обрабатывают одну задачу | Kafka consumer group + единственный producer перехода `start_static` |
| API получает два `static_completed` на одну задачу | Не возникает — воркер публикует ровно одно сообщение на task |
| Параллельные UPDATE-ы статуса | Все UPDATE-ы инициирует только один процесс — analysis-api consumer goroutine |
| Параллельный upload/quota | Redis `INCR` атомарен |
| Дубликат INSERT в ClickHouse при retry | Сейчас не защищён — допускаем дубли, агрегация по `task_id` устойчива |

## Расширенный health (`GetSystemStatus`)

```go
func (uc *AnalysisUseCase) GetSystemStatus(ctx) model.SystemStatus {
    status := model.SystemStatus{...}

    if err := uc.repo.Ping(ctx);     err != nil { status.Postgres   = down(err) }
    if err := uc.minio.HealthCheck(ctx); err != nil { status.MinIO  = down(err) }
    if err := uc.clickhouse.Ping(ctx);   err != nil { status.ClickHouse = down(err) }

    queueSize, err := uc.getKafkaQueueSize()
    if err != nil { status.Kafka = down(err) }
    status.StartStaticQueue = queueSize
    return status
}
```

`getKafkaQueueSize`:

```go
broker := strings.Split(uc.kafkaBrokers, ",")[0]
conn, _ := kafkago.DialLeader(ctx, "tcp", broker, kafka.TopicStartStatic, 0)
first, _ := conn.ReadFirstOffset()
last, _  := conn.ReadLastOffset()
return last - first, nil
```

::: tip Дешёвый indicator backpressure
Это не тот же offset, что у consumer group, а total-инструмент: разница между last и first offset = всего сообщений в топике (с учётом retention). Полезно как первый сигнал: "что-то накопилось" → фронт сам поллит каждые несколько секунд админ-панель.
:::
