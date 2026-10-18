# Proposed backend decision boundary v1.0

Это **новый предлагаемый backend-контракт**, не схема существующего visual
`result.json` и не утверждение о функциях/CLI текущего ML-кода.

## Что известно о существующем visual output

- `events` — наблюдения, не нарушения.
- `status="done"` завершает только visual stage.
- В текущем handoff отсутствуют окончательные `verdict` и `violations`.
- `partial_or_invalid` не является успешным final analysis.
- Пустые events не означают `no_violation`.
- Top-level event timestamps уже относятся к входному файлу; не прибавлять chunk offset повторно.
- Аргументы существующего interactive CLI неизвестны: backend не вызывает выдуманный CLI.
- Интерпретация законов и mapping второго decision model принадлежат ML/rules owners.

Наблюдения можно сохранять в `job_request.artifacts_dir`, отдельно от `final_result.json`.
Нельзя искать «самый свежий result.json»; пути всегда привязаны к конкретному job ID.

## Adapter lifecycle

В `sentry/adapters.py` определены новые backend-интерфейсы:

```python
initialize() -> None
analyze(job_request: JobRequest) -> DecisionResult
shutdown() -> None
```

`JobRequest` содержит server-generated job_id, абсолютный input_path,
artifacts_dir, проверенную source_duration_sec и абсолютный deadline (Unix seconds).
Пути никогда не принимаются от HTTP-клиента. `initialize` вызывается один раз на
постоянный processing child; успешные jobs используют тот же adapter. После ошибки,
зависания/crash child заменяется. `shutdown` вызывается при нормальном выходе;
при принудительном завершении полагаться на него для безопасности нельзя.

`RealPipelineAdapter.initialize/analyze` сейчас выбрасывают `ML_NOT_CONFIGURED`.
Здесь владельцам ML предстоит подключить реальный visual + decision pipeline.
Модельные imports/translation должны оставаться внутри этой границы. API, routes,
SQLite и serialization не должны импортировать ML frameworks. Не добавлять fallback
на MockPipelineAdapter и не считать initialization успешным до готовности всех стадий.

При документированном запуске API и supervisor используют
`<repo>\backend\.venv\Scripts\python.exe`. Worker создаёт processing child через
`multiprocessing.get_context("spawn")`, без `set_executable` или отдельного ML bridge.
Проверка отдельным spawn-процессом 2026-10-18 подтвердила тот же `sys.executable`
и `sys.prefix` backend venv у родителя и потомка. Базовый runtime этой копии:
`<repo>\backend\.python\cpython-3.11.17-windows-x86_64-none\python.exe`.
Spawn сам по себе **не активирует ML-окружение**. В backend venv отсутствуют
`torch`, `transformers`, `bitsandbytes` (проверено через `find_spec`, без импорта моделей).

Со слов команды, visual использует на другом GPU-компьютере
`D:\cashier-ai\.venv_qwen\Scripts\python.exe`. Decision предполагается запускать
в той же среде, но фактическая установка не проверена; считать общую среду подтверждённой нельзя.
После получения рабочих исходников нужно выбрать минимальный совместимый вызов
их фактических Python executables под существующим Windows Job Object. Не устанавливать
backend dependency lock в рабочую ML-среду и не обновлять её пакеты ради интеграции.
В этой проверке никакая ML-среда не изменялась. Модели, которые создают
внешний независимый daemon вне дерева worker, требуют отдельного согласованного
lifecycle; такой daemon сейчас не поддерживается механизмом timeout.

## Stage 3: блокер интеграции (2026-10-18)

В доступных исходниках этого репозитория найдены frontend, backend и тесты;
рабочих visual/decision модулей и примеров их окончательного решения нет.
Конкурсные медиа и описания не читались. По уточнению пользователя, ML находится
на Windows GPU-компьютере товарища в `D:\cashier-ai`, а не на текущей машине.
Приведённые ниже пути сообщены командой, их содержимое здесь не проверено.
Visual выдаёт структурированные наблюдения. Документированный
`qwen_review\quick_review.py` выдаёт rule-based гипотезы, а не окончательные нарушения.
Подтверждённого final JSON с `verdict` и `violations` пока нет. Отдельная обученная
decision-модель может существовать, но её актуальные код, checkpoint и формат не переданы.
`RealPipelineAdapter` остаётся `ML_NOT_CONFIGURED`, real readiness — false.
Новый bridge, mapping и ML-параметры конфигурации до получения интерфейса не добавлены.

### Что передать из текущего visual/review проекта

Сохранить структуру каталогов и локальные imports. Нужны актуальные рабочие версии:

- Из `D:\cashier-ai\qwen_local\`: `qwen_events_console.py`, `analyze.py`,
  `media.py`, `common.py`, `events_codec.py`, `events_runtime.py`,
  `prompt_events.txt`, `prompt.txt`. Если вспомогательный файл фактически лежит
  в другом месте, сохранить его реальный путь и указать это в handoff.
- `D:\cashier-ai\qwen_review\quick_review.py` и
  `D:\cashier-ai\qwen_review\rules.demo.json` — для изучения существующего review,
  без признания гипотез финальными findings или demo rules проверенными нормами.
- Все локальные модули, package `__init__.py` и конфиги, которые эти файлы реально
  импортируют/читают; имеющийся dependency manifest/lock и обезличенный список
  установленных версий из рабочей ML-среды. Удалить credentials/private index tokens.
- Фактическая команда запуска, working directory и пример single-video вызова
  из текущего кода: аргументы/возврат, явные input/output paths, порядок runtime
  initialization, установки events decoder, finalization и shutdown.
- Подтверждение версии Python и интерпретатора каждого этапа. Заявленный visual
  Python: `D:\cashier-ai\.venv_qwen\Scripts\python.exe`; model directory:
  `D:\cashier-ai\models\Qwen3.5-9B`. Передать используемые loader/config сведения
  и перечень необходимых локальных assets; веса и venv в исходный пакет не нужны.
  Нужны также испытанный lifecycle и GPU placement/unloading, настройки offline loading.

### Обезличенные примеры интерфейсов

Использовать синтетические входы и заменители текста, сохраняя настоящие имена полей,
типы, вложенность, null/отсутствующие значения и единицы измерения. Не передавать
конкурсные видео, кадры, сгенерированные по ним описания, секреты или сырые model logs.

- Visual: завершённый output с несколькими наблюдениями, пустыми наблюдениями,
  `partial_or_invalid`/ошибкой; примеры timestamp `0.0` и дробных секунд.
  Указать, относятся ли времена к исходнику, chunk или trim, и где хранится смещение.
- Review: фактический вход из visual и соответствующий output с гипотезами,
  вариант без гипотез и ошибка; пояснить поля статуса, rule IDs и source metadata.
  Эти примеры нужны для понимания интерфейса, не для mapping в final violations.
- Финальный decision, **когда он появится**: реальная схема/валидатор и outputs
  завершённого отрицательного решения, нескольких окончательных нарушений,
  незавершённого/ошибочного решения. Нужны реальные признаки completion/provenance,
  event type/объяснения, обоснованные evidence times, нормативные идентификаторы
  и source metadata, привязка времени к оригиналу. Backend не назначает имена ML-полей.

### Что отдельно требуется для завершения Stage 3

Передача visual и rule-based review позволит изучить эти этапы, но не устранит
блокер окончательного решения. От владельца актуального decision нужны его исходники
и реальные entry points, loader обученного checkpoint/adapter, локальные asset paths,
обязательные prompts/config/rules, зависимости и подтверждённая среда исполнения.
Точные имена этих файлов пока неизвестны; `quick_review.py` не считается их заменой.
Нужно согласовать с владельцами decision/rules, какой output является окончательным
и какие нормативные ресурсы обязательны для успешного завершения.

Удалённые пути выше — сведения для handoff, **не новые environment variables**
и не hardcoded пути приложения. Архитектура и runtime-код не изменены;
jury по-прежнему не получает mock fallback.
Таблицу «ML field → backend field → validation» можно составить только по фактическому
final output. Пример ниже описывает исключительно backend boundary, не ML-схему.
`events`, visual `done` и пустые наблюдения не заменяют окончательное решение.

Команды существующего API/worker/frontend и mock smoke приведены в
[README](README.md) и [корневом README](../README.md). Переключение
`PIPELINE_MODE=real` пока не подключает модели. Достоверных команд real/GPU acceptance
нет до получения реальных entry points и конфигурации; аргументы CLI не предполагаются.
После подключения отдельно потребуются cold initialization, первый и повторный jobs,
полное elapsed time, peak GPU memory, проверка без исходящего сетевого доступа и
локальная оценка качества. Тесты с doubles эти проверки не заменяют.

## Минимальный окончательный результат

Пример структуры для **тестового** нарушения, не реальное заключение:

```json
{
  "schema_version": "1.0",
  "complete": true,
  "source_duration_sec": 12.0,
  "verdict": "violation",
  "violations": [
    {
      "type": "TYPE_SUPPLIED_BY_DECISION_OWNER",
      "timecode_sec": 0.0,
      "description": "Description supplied by the final decision adapter",
      "evidence_timestamps": [0.0, 0.5],
      "regulatory_references": null
    }
  ],
  "is_demo": false,
  "provenance": "identifier-supplied-by-pipeline-owner"
}
```

`no_violation` требует `violations: []` и такой же явный `complete: true` после
всех необходимых стадий. Отсутствующий verdict, observations/events-only, partial,
ошибка модели, timeout или невалидная схема дают failed; backend не «додумывает» решение.
Дополнительные поля верхнего уровня запрещены. Максимум 100 final violations,
1–3 evidence timestamps на каждое. Все timestamp конечны, в `[0, source_duration_sec)`.
Длительность должна совпадать с проверенной длительностью видео из JobRequest.
`complete` требует именно boolean true. `is_demo` должен соответствовать неизменным
метаданным job; jury не принимает demo ни при какой последующей смене конфигурации.

`regulatory_references` — необязательный JSON-array объектов, без придуманной
backend-схемы правовых норм. Передаётся UI как metadata; не попадает в strict jury JSON.
Не помещайте в него секреты/сырые diagnostics. Provenance — короткий идентификатор
источника решения, не сырой model response. Ответственность за смысл и происхождение
реального решения остаётся у pipeline owner, структурная валидация этого не доказывает.

## Evidence и завершение

Backend выбирает для каждого requested timestamp первый реально декодированный
кадр на/после него, сохраняет JPEG и записывает:

- `frame_id`, actual `timestamp_sec`;
- `requested_timestamp_sec` и `selection_offset_sec = actual - requested`;
- проверенные width и height.

Jury получает actual timestamp и base64 декодируемого JPEG, без внутренних ссылок,
offset metadata и regulatory metadata. UI получает frame_id/URL и offset metadata.
Пример: request 0.05 s в 10 FPS видео → frame 0.1 s, offset +0.05 s.
Не подменять такой результат timestamp=0.05. Если подходящего кадра нет, завершение failed.
Адаптер должен выбирать содержательно обоснованные timestamps; backend не решает,
доказывает ли кадр заявленное нарушение. Никаких random thumbnails или blanket transcoding.

`FinalResult` оборачивает проверенный `DecisionResult` и evidence metadata.
Это внутренний `final_result.json` данного backend. Он записывается атомарно,
читается/валидируется повторно вместе с JPEG, затем DB status становится done при
ещё действительном deadline и ownership. Защита terminal state не даёт позднему
результату отменить timeout. Повреждённые/недостающие artifacts не дают jury success.

## Что требуется от владельцев ML для следующего этапа

1. Подтвердить callable/library entry point, initialization/shutdown и необходимые runtime dependencies.
2. Соединить visual observations с реальным вторым decision model; согласовать его окончательную схему.
3. Поставлять complete/verdict/violations/provenance и source-relative evidence timestamps согласно контракту.
4. Согласовать meaning/type/regulatory metadata с rules owners; backend законов не содержит.
5. Проверить deadlines, crash cleanup, GPU reuse и память в отдельной ML-среде.
6. Пройти existing contract tests и новые интеграционные тесты реальных выходов, прежде чем объявлять jury ready.
