# Фактическая проверка Stage 1

Дата: **2026-10-18**. Тестирование выполнено **на Windows**, не в Linux-контейнере.
Python `platform.platform()`: `Windows-10-10.0.26200-SP0` (идентификатор платформы Python).

## Команды и результаты

```powershell
Set-Location C:\Users\Shwepes\datathon\backend
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m pip check
```

Финальный прогон: **69 passed**, **0 failed**, **0 skipped**.
Один warning: Starlette 1.8.0 сообщает, что httpx-интеграция TestClient deprecated
в пользу httpx2. Проверенная связка httpx 0.28.1 продолжает работать; warning не скрыт.
`pip check`: **No broken requirements found.**

Установлено и использовано:

| Компонент | Версия |
| --- | --- |
| CPython x64 | 3.11.17, workspace-local standalone runtime |
| FastAPI | 0.143.3 |
| Starlette | 1.8.0 |
| Uvicorn | 0.54.0 |
| Pydantic / pydantic-core | 2.14.1 / 2.50.1 |
| pydantic-settings | 2.16.0 |
| python-multipart | 0.0.32 |
| Pillow | 12.3.0 |
| pytest | 9.1.1 |
| httpx | 0.28.1 |
| FFmpeg / ffprobe | 8.1-full_build-www.gyan.dev |
| pip / setuptools (venv tooling) | 24.0 / 79.0.1 |
| uv (только отдельный bootstrap) | 0.13.1 |

Полные runtime/test pins находятся в [requirements.lock](requirements.lock).
`torch`, `transformers`, `bitsandbytes` отсутствуют в backend venv, проверено
`importlib.util.find_spec`. GPU packages и model weights не устанавливались.

## Покрытые сценарии

- Constant-time jury auth, пустой серверный ключ и неверный/отсутствующий client key.
- 202 upload/job_id с controlled ready adapter, strict processing/done/failed JSON.
- Оба verdict, несколько violations, реальный JPEG/base64, отсутствие metadata в jury.
- Empty/oversized/multiple/wrong-field/unsupported/corrupt uploads, лишние fields,
  uppercase MOV, generic MIME, chunked body без Content-Length, bounded headers.
- Deadline при медленной загрузке и закрытие partial multipart spool.
- Пять контейнеров MOV/MP4/AVI/MKV/WebM на synthetic source; это не гарантия всех кодеков.
- Timestamp 0.0, invalid/NaN/infinite/out-of-range, actual PTS и selection offset;
  nonzero-origin MOV и MKV; отказ при недоступном evidence frame и повреждённом JPEG.
- Disguised playlist rejection, сохранение исходных байтов видео.
- Session hash storage, Origin/CSRF, приватность history/job/video/evidence,
  pagination, Range 206, сохранение данных при пересоздании API.
- Mock isolation, включая смену настройки на real, безопасный disabled default,
  production mock rejection и явный ML_NOT_CONFIGURED.
- Observation-only/partial output не валидируется как финальное решение.
- Atomic claim при конкурирующих DB callers, exclusive OS worker lock, queued expiry,
  ownership guard и отказ late completion после terminal failure.
- Persistent child reused для успешных jobs; adapter failure и аварийный os._exit
  ведут к безопасной переинициализации.
- Зависший processing child с собственным subprocess: deadline завершает всё его
  дерево, следующий job обрабатывается после подтверждения выхода.
- Принудительное завершение supervisor: Windows Job Object завершает потомков;
  replacement worker честно завершает orphan и продолжает действительную очередь.
- Lease-protected cleanup incomplete uploads сохраняет active writer и completed upload.
- Настоящие отдельные процессы Uvicorn CLI + worker CLI, HTTP session/upload/poll/evidence
  на loopback. Эти процессы завершены после теста.

В ходе разработки crash regression обнаружил Windows BrokenPipeError при poll;
обработчик исправлен и повторно проверен. Тестовая остановка через shared Event
заменена на file signal, чтобы test harness не зависал после принудительного crash.

## Что не проверялось

- Реальные модели, CUDA/GPU память, качество детекции, юридическая интерпретация,
  реальная ML latency и конкурсный лимит времени.
- Production HTTPS/reverse proxy, нагрузка, восстановление после отключения питания,
  service-account deployment и разные Windows login sessions.
- Реальное воспроизведение всех кодеков в браузере и подключение React.
- Worker на Linux/macOS: supervisor этого этапа предназначен для Windows.

Тестовые данные созданы локально через lavfi; конкурсные датасеты не читались.
Не было commit/push/deploy. Изменения находятся только в `backend/`; существующие
tracked-файлы проекта сохранены (`git diff --exit-code` прошёл).
