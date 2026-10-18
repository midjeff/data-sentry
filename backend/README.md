# DATA Sentry backend — Stage 1

## Vercel services

See the [root deployment guide](../README.md#vercel-deployment) for the new cloud
entrypoint (`main:app`), Postgres migration, blocked Blob uploads, Queue subscriber,
and runtime `STORAGE_URL` binding. Vercel uses Python 3.12 and Postgres;
the Windows/SQLite workflow below remains a separate local development option.
ForteBank requires local AI processing: the real pipeline must run on the GPU
computer, never in a Vercel Function. GPU integration is not implemented or verified.
Blob upload tokens and writes are blocked pending explicit data-locality approval;
the queue consumer rejects jobs without downloading media or invoking an adapter.
Credentials, hosted migrations and deployment checks remain outstanding.
The Vercel entrypoint never reads the local `.env`; hosted CORS/CSRF origins are
restricted to exact trusted deployment URLs, with localhost development-only.

Рабочий backend для локальной Windows-машины: FastAPI, SQLite-очередь, отдельный
последовательный worker, приватная история браузера, проверка видео и извлечение JPEG.
На Stage 1 React не менялся. В Stage 2 существующий frontend подключён к этому API:
session/upload/polling, серверные результаты, media и приватная история.
Команды трёх терминалов и результаты интеграционных проверок — в [корневом README](../README.md).

Реальная ML-интеграция отсутствует намеренно. `RealPipelineAdapter` отвечает
`ML_NOT_CONFIGURED`; jury-загрузка возвращает 503, пока настоящий адаптер не готов.
Mock доступен только браузерному API в development. Это не production-ready сервис.

## Установка в Windows PowerShell

Требуются Python **3.11 x64**, FFmpeg и ffprobe. GPU для разработки не нужен.
Worker этого этапа использует Windows Job Objects; Linux/macOS-supervisor не реализован.
API и unit-тесты не импортируют torch, transformers, bitsandbytes или CUDA.

В этой рабочей копии уже созданы изолированные `.python/` и `.venv/`.
Существующая ML-среда и системные Python не изменены. Команды для этой машины:

```powershell
Set-Location C:\Users\Shwepes\datathon\backend
# Только если нужно заново создать backend venv из локально установленного runtime:
.\.python\cpython-3.11.17-windows-x86_64-none\python.exe -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock -e '.[test]'
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

На другой машине вместо первой Python-команды используйте установленный Python 3.11:
`py -3.11 -m venv .venv`. Активация venv и изменение ExecutionPolicy не нужны.
Проверьте `ffmpeg -version`, `ffprobe -version` либо задайте абсолютные пути в `.env`.
В `.env.example` указан путь DATA_DIR этой машины — замените его при переносе.

`requirements.lock` фиксирует все установленные runtime/test-зависимости; editable
пакет устанавливается отдельно через `-e '.[test]'`. `.bootstrap/` содержит только
локальный установщик uv и не требуется для запуска сервиса.

## Запуск mock в двух терминалах

В обоих терминалах задайте одинаковый **абсолютный локальный DATA_DIR** и режим.
По умолчанию режим `disabled`; пример `.env` также не включает обработку автоматически.

Терминал 1 — API:

```powershell
Set-Location C:\Users\Shwepes\datathon\backend
$env:APP_ENV = 'development'
$env:PIPELINE_MODE = 'mock'
$env:MOCK_SCENARIO = 'violations'
$env:DATA_DIR = 'C:\Users\Shwepes\datathon\backend\data'
$env:COOKIE_SECURE = 'false'
.\.venv\Scripts\python.exe -m uvicorn sentry.api:create_app --factory --host 127.0.0.1 --port 8000
```

Терминал 2 — worker:

```powershell
Set-Location C:\Users\Shwepes\datathon\backend
$env:APP_ENV = 'development'
$env:PIPELINE_MODE = 'mock'
$env:MOCK_SCENARIO = 'violations'
$env:DATA_DIR = 'C:\Users\Shwepes\datathon\backend\data'
$env:COOKIE_SECURE = 'false'
.\.venv\Scripts\python.exe -m sentry.worker
```

Сценарии `MOCK_SCENARIO`: `no_violation`, `violations` (два искусственных события),
`failure`. После смены сценария перезапустите worker. Имя и содержание видео не
выбирают сценарий. Все mock-задания имеют `is_demo=true`; JPEG взяты из видео,
но остаются **демонстрационными кадрами, не доказательствами нарушения**.
В production mock запрещён настройками; HTTPS production требует `COOKIE_SECURE=true`.

## Создание браузерной сессии и mock-задания

В третьем PowerShell-терминале выполните пример с синтетическим локальным видео:

```powershell
Set-Location C:\Users\Shwepes\datathon\backend
New-Item -ItemType Directory -Force data | Out-Null
ffmpeg -v error -f lavfi -i 'testsrc2=size=320x240:rate=10' -t 2 -c:v mpeg4 -y data\demo.mov
$base = 'http://127.0.0.1:8000'
$origin = 'http://localhost:5173'
$cookieFile = Join-Path $PWD 'data\demo-cookies.txt'
$sessionJson = curl.exe -sS -c $cookieFile -X POST "$base/api/ui/session" -H "Origin: $origin"
$csrf = ($sessionJson | ConvertFrom-Json).csrf_token
$uploadJson = curl.exe -sS -b $cookieFile -H "Origin: $origin" -H "X-CSRF-Token: $csrf" -F 'file=@data/demo.mov;type=application/octet-stream' "$base/api/ui/analyze"
$jobId = ($uploadJson | ConvertFrom-Json).job_id
curl.exe -sS -b $cookieFile "$base/api/ui/jobs/$jobId"
curl.exe -sS -b $cookieFile "$base/api/ui/jobs?limit=20&offset=0"
```

Повторяйте GET задания до `done`/`failed`. Cookie — секрет доступа к этой истории;
не коммитьте и не передавайте cookie-файл. Без cookie история недоступна; после
утраты/истечения сессии восстановление доступа в Stage 1 не предусмотрено.
Повторный POST session с действующей cookie сохраняет владельца и выдаёт новый CSRF-токен.
Сессия хранится 30 дней по умолчанию; автоматического удаления анализов нет.

Frontend использует `credentials: 'include'`, получает `csrf_token`
через POST session и передаёт его в `X-CSRF-Token` для POST analyze.
Origin проверяется и при создании сессии, и при загрузке. Источники должны точно
совпадать с `ALLOWED_ORIGINS`; wildcard с credentials не допускается.
Для SameSite=Lax frontend и API должны работать в совместимом same-site размещении.
Например, для браузерного fetch используйте `http://localhost:5173` и
`http://localhost:8000`, сохраняя одинаковое написание hostname в обоих адресах.

## HTTP-контракт

| Метод и путь | Авторизация / результат |
| --- | --- |
| POST `/api/v1/analyze` | `X-API-Key`, ровно один multipart `file`; 202 `{"job_id":"..."}` |
| GET `/api/v1/jobs/{id}` | `X-API-Key`; `processing`, `done` или `failed` |
| POST `/api/ui/session` | Разрешённый Origin; HttpOnly SameSite=Lax cookie и CSRF-токен |
| POST `/api/ui/analyze` | Cookie + Origin + CSRF; тот же сервис загрузки и очередь |
| GET `/api/ui/jobs?limit=20&offset=0` | Cookie; своя история, limit 1–100, без изображений/base64 |
| GET `/api/ui/jobs/{id}` | Cookie; свой статус, этап, demo, результат и timings |
| GET `/api/ui/jobs/{id}/video` | Cookie, владение; оригинал, поддержка Range |
| GET `/api/ui/jobs/{id}/evidence/{frame_id}` | Cookie, владение; проверенный JPEG |
| GET `/health/live` | API работает; не свидетельство готовности ML |
| GET `/health/ready` | API, heartbeat worker, demo availability, real readiness отдельно |

Readiness возвращает 200, когда совместимый worker инициализирован для выбранного
режима, иначе 503. Для mock `real_pipeline_ready=false` всегда. При `disabled` API
жив, но readiness=503. Инициализация real сейчас закономерно не проходит.

Jury-ключ берётся только из серверного `JURY_API_KEY`; пустой/неверный ключ — 401,
сравнение constant-time. UI не получает ключ. Jury видит только real jury-задания;
browser-задания (включая mock после смены конфигурации) через jury недоступны.
Чужой browser job, video и evidence возвращают 404. Jury jobs не входят в историю UI.

Jury `done` содержит только `job_id`, `status`, `verdict`, `violations`; каждая violation:
`type`, `timecode_sec`, `description`, `evidence_frames` с `timestamp_sec` и
`image_base64` действительного JPEG. `no_violation` требует пустого массива.
Ошибка задания: `{"job_id":"...","status":"failed","error":{"code":"JOB_TIMEOUT","message":"..."}}`.
Ошибки HTTP: `{"error":{"code":"...","message":"..."}}` без внутренних путей и traceback.
Если сохранённый обязательный artifact повреждён, jury отдаёт `failed/ARTIFACT_UNAVAILABLE`,
а не успешный результат. Завершённые файлы автоматически не удаляются.

## Хранение и жизненный цикл

```text
DATA_DIR/
  app.sqlite3 (+ WAL/SHM)
  worker.lock
  jobs/<unpredictable-job-id>/
    .upload.lock
    input.<validated-extension>
    artifacts/
    evidence/<frame-id>.jpg
    final_result.json
```

SQLite: WAL, foreign keys, busy timeout 5 s, параметризованные запросы, короткие
транзакции. Каждый вызов открывает своё соединение; между процессами соединения
не передаются. DATA_DIR должен быть на локальном диске (UNC/network drives отклоняются),
закрытом от статической раздачи и доступном только API/worker service account.
Один GPU-slot предполагает **один общий DATA_DIR**; не запускайте независимые очереди
с разными DATA_DIR на одном GPU. Между разными DATA_DIR глобального GPU-планировщика нет.

Очередь хранится в SQLite. Один supervisor удерживает OS file lock, а его постоянный
spawn-child и все потомки входят в Windows Job Object с kill-on-close. Адаптер
инициализируется один раз и повторно используется после успешных заданий. По ошибке,
crash или deadline supervisor завершает только собственное дерево, проверяет его
полный выход, затем создаёт новый child и инициализирует адаптер снова. После ошибки
инициализации readiness остаётся false до перезапуска worker; silent mock fallback отсутствует.

После аварии supervisor ОС завершает принадлежащее ему дерево. Новый worker под
эксклюзивной блокировкой ждёт его выхода, помечает прерванные claimed jobs как
`WORKER_INTERRUPTED`, сохраняет ещё действительные queued jobs. Если дерево не
вышло, worker останавливается, не запускает следующую GPU-задачу. После обычного
Ctrl+C активное задание тоже завершается `failed`, а очередь сохраняется.

Этапы: preparing/upload → queued → preparing → observing → reasoning → evidence →
finalizing. Публичный unfinished status всегда `processing`. На этом этапе reasoning
включает проверку окончательного решения адаптера; legal inference backend не выполняет.

Общий deadline начинается при входе в обработчик загрузки: включает приём данных,
проверку/сохранение, ожидание очереди, обработку и финализацию. Он не сбрасывается
при claim. API/worker обнаруживают истёкшие задания; queued timeout не запускает ML.
Финальный DB update проверяет owner, deadline и nonterminal status; поздний результат
не перезаписывает failed. JSON записывается через временный файл, flush/fsync и
atomic replace, после чего проверяются файлы и лишь затем ставится done.

UI возвращает измеренное end-to-end время и доступные времена фаз; завершённые
успешные задания сохраняют все четыре фазы в SQLite. На failed/in-flight заданиях
незавершённая фаза отображается как прошедшее время; отсутствующую фазу не выдумываем.
Deadline 300 s не доказывает, что будущий ML укладывается в конкурсные пять минут.

При ошибке upload удаляется только его новый каталог и незавершённая запись.
После crash API worker очищает просроченные незавершённые upload-каталоги после
grace 5 s и проверки отсутствия активного upload file lock. Завершённые uploads,
результаты и история не подлежат такому удалению; failed запись после crash сохраняется.
Temporary multipart spools закрываются также при превышении лимита/deadline/disconnect.

## Проверка медиа

Разрешены `.mov`, `.mp4`, `.avi`, `.mkv`, `.webm` без учёта регистра. MIME может
быть пустым или `application/octet-stream`. Расширение не гарантирует поддержку кодека.
ffprobe проверяет видео/длительность; FFmpeg должен декодировать первый кадр.
Это проверка читаемого потока, а не гарантия отсутствия повреждений во всём файле.
Оригинальное видео не транскодируется и не меняет FPS. Клиент не передаёт пути,
URL или FFmpeg arguments; filename остаётся только метаданными.

Файл ограничен фактически прочитанными байтами при multipart parsing и chunk-copy.
**256 MiB — начальный лимит реализации, не требование соревнования.** Общий multipart
body ограничен file-limit + 64 KiB, ровно один файл, ноль дополнительных form fields.
Multipart headers дополнительно ограничены 16 KiB на часть.
Чтение/копирование по частям, с spool на диск. Queue capacity — незавершённые
зарезервированные задания; HTTP concurrency/rate limiting относится к будущему deployment.

Media subprocesses используют argument lists, `shell=False`, timeouts, локальные
server paths и ограниченные demuxer/protocol lists; переименованные playlists отвергаются.
Для evidence адаптер задаёт 1–3 timestamp на нарушение. FFmpeg декодирует в порядке
исходника и выбирает первый кадр на/после запроса. В JSON записываются actual PTS,
requested timestamp и selection offset; jury получает actual PTS. JPEG декодируется
и проверяется до base64. `0.0` допустим; NaN/Infinity/отрицательные/вне duration запрещены.
Если после запроса кадра нет, анализ не становится успешным. Nonzero start PTS
нормализуется относительно начала файла через `-copyts -start_at_zero` без изменения оригинала.

## Конфигурация

Все поля `Settings` задаются одноимёнными uppercase environment variables или `.env`:

| Параметр | По умолчанию / назначение |
| --- | --- |
| APP_ENV | development; production запрещает mock и insecure cookie |
| PIPELINE_MODE | disabled; mock или real включаются явно |
| DATA_DIR | абсолютный `backend/data`; один общий каталог API/worker |
| JURY_API_KEY | пусто → fail closed |
| ALLOWED_ORIGINS | JSON-array localhost:5173 и 127.0.0.1:5173 |
| COOKIE_SECURE / SESSION_TTL_SEC | false для локального HTTP / 2592000 |
| UPLOAD_LIMIT_BYTES | 268435456 |
| JOB_TIMEOUT_SEC | 300, полный бюджет задания |
| QUEUE_CAPACITY | 20 |
| WORKER_POLL_SEC / WORKER_STALE_SEC | 0.25 / 10 |
| WORKER_STARTUP_TIMEOUT_SEC | 60, отдельный предел инициализации моделей |
| MEDIA_TIMEOUT_SEC | 30, дополнительно ограничен оставшимся job budget |
| FFMPEG_PATH / FFPROBE_PATH | ffmpeg / ffprobe из PATH |
| MOCK_SCENARIO | no_violation; development only |

Логи содержат job ID, этап, длительность и безопасный error code; cookies, API key,
содержимое видео и сырые model responses не логируются. `.gitignore` внутри backend
исключает данные, venv/runtime/cache, .env, БД и веса. На Stage 1 изменения ограничивались
backend; frontend-интеграция Stage 2 описана в корневом README.

## Тесты и установленная среда

```powershell
Set-Location C:\Users\Shwepes\datathon\backend
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m pip check
# Только FFmpeg-ориентированные media-тесты:
.\.venv\Scripts\python.exe -m pytest tests\test_media.py -q
```

Тесты генерируют небольшие synthetic lavfi-видео в pytest temporary directories;
конкурсные датасеты не читаются. Без FFmpeg/ffprobe media-зависимые тесты явно skip.
Worker crash tests используют короткие deadlines и отдельные owned processes,
без ожиданий по пять минут. Test doubles существуют только в `tests/`, их нельзя
включить environment-переменной или HTTP-параметром.

Точный фактический результат и версии: [TESTING.md](TESTING.md). Контракт будущего ML:
[INTEGRATION.md](INTEGRATION.md). В будущем остаются real decision adapter/второй этап,
проверка реального GPU/runtime и evidence на реальных выходах,
HTTPS deployment и эксплуатационные ограничения. Конкурсная точность, юридические
выводы, нагрузка, браузерное декодирование всех кодеков и production deployment здесь не проверены.

Использованные upstream-интерфейсы: [Starlette multipart](https://www.starlette.io/requests/),
[FileResponse Range](https://www.starlette.io/responses/),
[Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
