"""Uses a disposable Postgres cluster; never reads the application's DATABASE_URL."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
from types import SimpleNamespace
import uuid

import pytest
from fastapi.testclient import TestClient

from sentry.api import create_app
from sentry.cloud_db import CloudDatabase
from sentry.cloud_storage import CloudStorage, input_key
from sentry.config import Settings
from sentry.errors import SentryError
from .conftest import browser_session


@pytest.fixture(scope='module')
def postgres_url(tmp_path_factory):
    binaries = Path(os.environ.get('TEST_POSTGRES_BIN', 'C:/Program Files/PostgreSQL/17/bin'))
    initdb = shutil.which('initdb') or str(binaries / 'initdb.exe')
    postgres = shutil.which('postgres') or str(binaries / 'postgres.exe')
    if not Path(initdb).is_file():
        pytest.skip('Set TEST_POSTGRES_BIN to run real Postgres integration tests')
    root = tmp_path_factory.mktemp('cloud-postgres')
    data = root / 'data'
    subprocess.run([initdb, '-D', str(data), '-U', 'sentry_test', '-A', 'trust', '--no-locale', '-E', 'UTF8'],
                   check=True, capture_output=True, timeout=30)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    with (root / 'postgres.log').open('w') as log:
        process = subprocess.Popen([postgres, '-D', str(data), '-h', '127.0.0.1', '-p', str(port)],
                                   stdout=log, stderr=log, creationflags=flags)
        try:
            import psycopg
            url = f'postgresql://sentry_test@127.0.0.1:{port}/postgres'
            for _ in range(100):
                try:
                    with psycopg.connect(url):
                        break
                except psycopg.OperationalError:
                    time.sleep(.1)
            else:
                pytest.fail('Test Postgres did not start')
            yield url
        finally:
            ctl = str(Path(postgres).with_name('pg_ctl.exe' if os.name == 'nt' else 'pg_ctl'))
            subprocess.run([ctl, '-D', str(data), 'stop', '-m', 'fast'], capture_output=True, timeout=20)
            process.wait(timeout=20)


@pytest.fixture
def unmigrated_cloud(postgres_url, tmp_path):
    import psycopg
    from psycopg import sql
    from psycopg.conninfo import make_conninfo
    schema = 'test_' + uuid.uuid4().hex
    with psycopg.connect(postgres_url) as connection:
        connection.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
    settings = Settings(_env_file=None, storage_backend='vercel', data_dir=tmp_path,
                        database_url=make_conninfo(postgres_url, options=f'-c search_path={schema}'),
                        pipeline_mode='disabled', job_timeout_sec=120)
    db = CloudDatabase(settings)
    yield settings, db
    with psycopg.connect(postgres_url) as connection:
        connection.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))


@pytest.fixture
def cloud(unmigrated_cloud):
    settings, db = unmigrated_cloud
    db.migrate()
    return settings, db


def test_session_missing_database_url_reports_database_failure(tmp_path, caplog, monkeypatch):
    settings = Settings(_env_file=None, storage_backend='vercel', database_url='', data_dir=tmp_path)
    monkeypatch.setattr('psycopg.connect', lambda *_args, **_kwargs: pytest.fail('Connected without DATABASE_URL'))
    monkeypatch.setattr(CloudStorage, 'signing_request', lambda *_: pytest.fail('Session contacted Blob'))
    with TestClient(create_app(settings), raise_server_exceptions=False) as client:
        assert client.get('/api/health/live').status_code == 200
        assert client.post('/api/ui/session').status_code == 403
        response = client.post('/api/ui/session', headers={'Origin': 'http://localhost:5173'})
        assert response.status_code == 503
        assert response.json()['error']['code'] == 'DATABASE_UNAVAILABLE'
        assert 'set-cookie' not in response.headers
        assert response.headers['cache-control'] == 'no-store'
        assert 'DATABASE_URL_MISSING' in caplog.text


def test_session_recovers_only_after_real_postgres_migration(unmigrated_cloud, caplog, monkeypatch):
    settings, db = unmigrated_cloud
    # Session creation needs neither Blob credentials nor the storage binding.
    settings.storage_url = ''
    monkeypatch.setattr(CloudStorage, 'signing_request', lambda *_: pytest.fail('Session contacted Blob'))
    app = create_app(settings, db)
    with TestClient(app, raise_server_exceptions=False) as client, TestClient(app) as other:
        response = client.post('/api/ui/session', headers={'Origin': 'http://localhost:5173'})
        assert response.status_code == 503
        assert response.json()['error']['code'] == 'DATABASE_UNAVAILABLE'
        assert 'DATABASE_SCHEMA_MISSING' in caplog.text
        assert 'set-cookie' not in response.headers
        db.migrate()
        db.migrate()  # Reapplying the checked-in schema preserves existing data.
        headers = browser_session(client)
        batch = client.post('/api/ui/batches', headers=headers).json()['batch_id']
        assert client.post('/api/ui/batches', headers={'Origin': 'http://localhost:5173'}).status_code == 403
        browser_session(other)
        assert other.get(f'/api/ui/batches/{batch}').status_code == 404
        # Reuse the cookie, exercise SELECT + CSRF rotation, preserve ownership.
        rotated = browser_session(client)
        assert rotated['X-CSRF-Token'] != headers['X-CSRF-Token']
        assert client.get(f'/api/ui/batches/{batch}').status_code == 200
        assert client.post('/api/ui/batches', headers=headers).status_code == 403
        assert client.post('/api/ui/batches', headers=rotated).status_code == 200


@pytest.mark.parametrize('exception,reason', [
    ('InvalidPassword', 'DATABASE_AUTH_FAILED'),
    ('InsufficientPrivilege', 'DATABASE_PERMISSION_DENIED'),
    ('UndefinedColumn', 'DATABASE_SCHEMA_INCOMPLETE'),
    ('ConnectionFailure', 'DATABASE_CONNECTION_FAILED'),
])
def test_postgres_failure_diagnostics_do_not_leak_secrets(tmp_path, monkeypatch, caplog, exception, reason):
    import psycopg.errors
    secret = 'never-print-this-database-password'
    settings = Settings(_env_file=None, storage_backend='vercel', data_dir=tmp_path,
                        database_url=f'postgresql://test:{secret}@db.invalid/test')
    def fail(*_args, **_kwargs):
        raise getattr(psycopg.errors, exception)(f'private server detail {secret}')
    monkeypatch.setattr('psycopg.connect', fail)
    with TestClient(create_app(settings), raise_server_exceptions=False) as client:
        response = client.post('/api/ui/session', headers={'Origin': 'http://localhost:5173'})
        assert response.status_code == 503
        assert response.json()['error']['code'] == 'DATABASE_UNAVAILABLE'
        assert reason in caplog.text
        assert secret not in caplog.text + response.text
        assert 'set-cookie' not in response.headers


class MemoryBlob:
    def __init__(self):
        self.data = {}
        self.tokens = []

    def upload_token(self, pathname, size):
        self.tokens.append((pathname, size))
        return 'test-client-token'

    def head(self, pathname):
        return SimpleNamespace(pathname=pathname, size=len(self.data[pathname]))

    def download(self, pathname, target, limit):
        data = self.data[pathname]
        assert len(data) <= limit
        target.write_bytes(data)
        return len(data)

    def write(self, pathname, data, content_type):
        assert pathname not in self.data
        self.data[pathname] = data

    def read(self, pathname):
        return self.data[pathname]

    def read_url(self, pathname):
        return 'https://example.private.blob.vercel-storage.com/' + pathname + '?test=signed'

    def delete_job(self, job_id):
        self.data = {key: value for key, value in self.data.items() if not key.startswith(f'jobs/{job_id}/')}


def reserved(db):
    job_id = uuid.uuid4().hex
    db.create_session(job_id, 'csrf', )
    db.reserve(job_id, job_id, 'ui', 'test.mp4', '.mp4', time.time())
    return job_id


@pytest.mark.parametrize('mode', ['disabled', 'real', 'mock'])
def test_cloud_disabled_before_upload_credentials(cloud, mode):
    settings, db = cloud
    settings.pipeline_mode = mode
    storage = MemoryBlob()
    with TestClient(create_app(settings, db, storage, lambda _: pytest.fail('Published while disabled'))) as client:
        headers = browser_session(client)
        assert client.get('/api/health/live').status_code == 200
        assert client.get('/api/health/ready').status_code == 503
        response = client.post('/api/ui/uploads', headers=headers,
                               json={'filename': 'x.mp4', 'size': 8, 'display_name': 'x'})
        assert response.status_code == 503
        assert not storage.tokens


def test_complete_is_atomic_and_duplicate_deliveries_fenced(cloud):
    settings, db = cloud
    job_id = reserved(db)
    def failure(_):
        raise RuntimeError('Simulated queue outage')
    with pytest.raises(RuntimeError):
        db.complete_upload(job_id, 10, failure)
    assert db.get(job_id)['uploaded_at'] is None
    messages = []
    db.complete_upload(job_id, 10, messages.append)
    db.complete_upload(job_id, 10, messages.append)
    assert messages == [{'job_id': job_id, 'attempt': 1}]
    first = db.claim_delivery(job_id, 1)
    with pytest.raises(RuntimeError):
        db.claim_delivery(job_id, 1)
    with db.connect(True) as connection:
        connection.execute('UPDATE jobs SET lease_until=0 WHERE id=?', (job_id,))
    second = db.claim_delivery(job_id, 1)
    assert first['worker_id'] != second['worker_id']
    assert not db.finish_cloud(job_id, first['worker_id'], 'stale', 'no_violation')
    assert db.finish_cloud(job_id, second['worker_id'], 'new', 'no_violation')
    assert db.claim_delivery(job_id, 1) is None


def test_capacity_is_atomic_across_connections(cloud):
    settings, db = cloud
    settings.queue_capacity = 1
    def reserve(_):
        try:
            reserved(CloudDatabase(settings))
            return True
        except SentryError as error:
            assert error.code == 'QUEUE_FULL'
            return False
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(pool.map(reserve, range(4))) == 1


def test_private_artifact_ownership_with_synthetic_fixtures(cloud, monkeypatch):
    from sentry.contracts import FinalResult
    settings, db = cloud
    settings.pipeline_mode = 'real'
    # Test only: fake upload transport and seeded results, no cloud bytes or ML.
    monkeypatch.setattr('sentry.cloud_uploads.require_processing', lambda *_: None)
    monkeypatch.setattr('sentry.api.require_processing', lambda *_: None)
    storage, messages = MemoryBlob(), []
    app = create_app(settings, db, storage, messages.append)
    with TestClient(app) as client, TestClient(app) as other:
        headers = browser_session(client)
        other_headers = browser_session(other)
        response = client.post('/api/ui/uploads', headers=headers,
                               json={'filename': 'a.MOV', 'size': 8, 'display_name': 'a'})
        assert response.status_code == 200
        upload = response.json()
        job_id = upload['job_id']
        assert storage.tokens == [(upload['pathname'], 8)]
        assert other.post(f'/api/ui/uploads/{job_id}/complete', headers=other_headers).status_code == 404
        assert other.get(f'/api/ui/jobs/{job_id}/video').status_code == 404
        storage.data[upload['pathname']] = b'testdata'
        assert client.post(f'/api/ui/uploads/{job_id}/complete', headers=headers).status_code == 202
        assert client.post(f'/api/ui/uploads/{job_id}/complete', headers=headers).status_code == 202
        assert len(messages) == 1
        job = db.claim_delivery(job_id, 1)
        frame_id = uuid.uuid4().hex
        result = FinalResult.model_validate({
            'decision': {'schema_version': '1.0', 'complete': True, 'source_duration_sec': 1.0,
                         'verdict': 'violation', 'is_demo': False, 'provenance': 'test-fixture-only',
                         'violations': [{'type': 'fixture', 'timecode_sec': 0.0,
                                         'description': 'Synthetic test', 'evidence_timestamps': [0.0]}]},
            'evidence': [[{'frame_id': frame_id, 'timestamp_sec': 0.0, 'requested_timestamp_sec': 0.0,
                          'selection_offset_sec': 0.0, 'width': 96, 'height': 64}]]})
        prefix = f"jobs/{job_id}/attempts/{job['worker_id']}"
        storage.data[prefix + '/final_result.json'] = result.model_dump_json().encode()
        db.set_duration(job_id, job['worker_id'], 1.0)
        db.finish_cloud(job_id, job['worker_id'], f"attempts/{job['worker_id']}/final_result.json", 'violation')
        detail = client.get(f'/api/ui/jobs/{job_id}').json()
        assert detail['status'] == 'done', detail
        assert detail['is_demo'] is False
        frame_url = detail['result']['evidence'][0][0]['url']
        assert client.get(frame_url, follow_redirects=False).status_code == 307
        assert other.get(frame_url).status_code == 404
        assert client.get(f'/api/ui/jobs/{job_id}/video', follow_redirects=False).status_code == 307
        assert len(client.get('/api/ui/jobs').json()['items']) == 1


def test_cancel_restore_and_obsolete_messages(cloud):
    settings, db = cloud
    job_id = reserved(db)
    messages = []
    db.complete_upload(job_id, 10, messages.append)
    first = db.claim_delivery(job_id, 1)
    db.cancel(job_id, job_id)
    assert not db.finish_cloud(job_id, first['worker_id'], 'wrong', 'no_violation')
    with pytest.raises(SentryError, match='release'):
        db.restore_cloud(job_id, job_id, messages.append)
    db.release_delivery(job_id, first['worker_id'])
    db.restore_cloud(job_id, job_id, messages.append)
    assert messages[-1]['attempt'] == 2
    assert db.claim_delivery(job_id, 1) is None
    assert db.claim_delivery(job_id, 2) is not None


def test_ambiguous_restore_publish_can_be_retried(cloud):
    settings, db = cloud
    job_id = reserved(db)
    db.complete_upload(job_id, 10, lambda _: None)
    db.cancel(job_id, job_id)
    delivered = []
    def ambiguous(payload):
        delivered.append(payload)
        raise RuntimeError('Message accepted but response lost')
    with pytest.raises(RuntimeError):
        db.restore_cloud(job_id, job_id, ambiguous)
    assert db.get(job_id)['attempt'] == 1
    assert db.claim_delivery(job_id, 2) is None
    db.restore_cloud(job_id, job_id, delivered.append)
    assert len(delivered) == 2
    assert db.claim_delivery(job_id, 2) is not None


def test_runtime_binding_used_without_browser_exposure(monkeypatch, tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path, storage_url='http://bound-storage.test/base/',
                        internal_service_token='test-only-secret')
    calls = []
    def post(url, **kwargs):
        calls.append((url, kwargs))
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {'url': 'https://private.test/signed'})
    monkeypatch.setattr('sentry.cloud_storage.httpx.post', post)
    assert CloudStorage(settings).read_url('jobs/test') == 'https://private.test/signed'
    assert calls[0][0] == 'http://bound-storage.test/base/read-url'
    assert calls[0][1]['headers'] == {'Authorization': 'Bearer test-only-secret'}


def test_vercel_entrypoint_does_not_connect_at_import(monkeypatch):
    monkeypatch.delenv('DATABASE_URL', raising=False)
    monkeypatch.setenv('PIPELINE_MODE', 'disabled')
    import runpy
    module = runpy.run_path(str(Path(__file__).parents[1] / 'main.py'))
    assert module['app'].state.settings.storage_backend == 'vercel'
    assert module['app'].state.settings.cookie_secure


def test_real_queue_sdk_dispatches_private_subscriber(cloud, monkeypatch):
    from vercel.queue.embedded import embedded_queue_service
    import sentry.cloud_tasks as tasks
    settings, db = cloud
    job_id = reserved(db)
    db.complete_upload(job_id, 10, lambda _: None)
    monkeypatch.setattr(tasks.Settings, 'for_vercel', classmethod(lambda cls: settings))

    async def exercise():
        async with embedded_queue_service() as service:
            client = service.get_async_client()
            await client.send('sentry-analysis', {'job_id': job_id, 'attempt': 1},
                              idempotency_key=job_id + ':1')
            for _ in range(200):
                row = await asyncio.to_thread(db.get, job_id)
                if row['status'] == 'failed':
                    assert row['error_code'] == 'ML_NOT_CONFIGURED'
                    return
                await asyncio.sleep(.02)
            pytest.fail('Queue SDK did not deliver to the subscriber')
    asyncio.run(exercise())


def test_cloud_writes_blocked_even_with_real_mode(monkeypatch, tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path, storage_backend='vercel', pipeline_mode='real')
    storage = CloudStorage(settings)
    monkeypatch.setattr(storage, 'signing_request', lambda *_: pytest.fail('Contacted storage'))
    for action in [lambda: storage.upload_token('jobs/test/input.mp4', 8),
                   lambda: storage.write('jobs/test/result.json', b'test', 'application/json')]:
        with pytest.raises(SentryError) as error:
            action()
        assert error.value.code == 'CLOUD_UPLOAD_NOT_APPROVED'


@pytest.mark.parametrize('mode', ['disabled', 'real', 'mock'])
def test_queue_cannot_run_inference_in_any_mode(cloud, monkeypatch, mode):
    from sentry.cloud_tasks import consume
    settings, db = cloud
    settings.pipeline_mode = mode
    monkeypatch.setattr('sentry.adapters.create_adapter', lambda *_: pytest.fail('Initialized ML'))
    monkeypatch.setattr(CloudStorage, 'download', lambda *_: pytest.fail('Downloaded media'))
    monkeypatch.setattr(CloudStorage, 'write', lambda *_: pytest.fail('Uploaded artifacts'))
    job_id = reserved(db)
    db.complete_upload(job_id, 8, lambda _: None)
    payload = {'job_id': job_id, 'attempt': 1}
    asyncio.run(consume(payload, settings, db))
    asyncio.run(consume(payload, settings, db))
    job = db.get(job_id)
    assert job['status'] == 'failed'
    assert job['error_code'] == 'ML_NOT_CONFIGURED'
    assert job['result_ref'] is None


@pytest.mark.parametrize('environment', ['production', 'preview'])
def test_hosted_origins_sessions_csrf_and_jury_auth(cloud, monkeypatch, environment):
    _, db = cloud
    monkeypatch.delenv('ALLOWED_ORIGINS', raising=False)
    monkeypatch.setenv('VERCEL_ENV', environment)
    monkeypatch.setenv('VERCEL_PROJECT_PRODUCTION_URL', 'sentry.example.com')
    monkeypatch.setenv('VERCEL_URL', 'sentry-hash-team.vercel.app')
    monkeypatch.setenv('VERCEL_BRANCH_URL', 'sentry-git-feature-team.vercel.app')
    monkeypatch.setenv('PIPELINE_MODE', 'real')
    monkeypatch.setenv('JURY_API_KEY', 'test-only-jury-key')
    settings = Settings.for_vercel()
    origin = 'https://sentry.example.com' if environment == 'production' else 'https://sentry-hash-team.vercel.app'
    app = create_app(settings, db, MemoryBlob(), lambda _: pytest.fail('Published a real job'))
    with TestClient(app, base_url=origin) as client:
        assert client.get('/api/ui/jobs').status_code == 401
        for rejected in ('http://localhost:5173', 'https://unrelated.vercel.app',
                         'https://sentry-hash-team.vercel.app.evil.test'):
            assert client.post('/api/ui/session', headers={'Origin': rejected}).status_code == 403
            cors = client.options('/api/ui/session', headers={
                'Origin': rejected, 'Access-Control-Request-Method': 'POST'})
            assert 'access-control-allow-origin' not in cors.headers
        response = client.post('/api/ui/session', headers={'Origin': origin})
        assert response.status_code == 200
        assert response.headers['access-control-allow-origin'] == origin
        assert 'STORAGE_URL' not in response.text
        cookie = response.headers['set-cookie']
        assert all(flag in cookie for flag in ('Secure', 'HttpOnly', 'SameSite=lax', 'Path=/api/ui'))
        csrf = response.json()['csrf_token']
        assert client.get('/api/ui/jobs').status_code == 200
        assert client.post('/api/ui/batches', headers={'Origin': origin}).status_code == 403
        assert client.post('/api/ui/batches', headers={'Origin': 'https://unrelated.vercel.app',
                                                     'X-CSRF-Token': csrf}).status_code == 403
        assert client.post('/api/ui/batches', headers={'Origin': origin, 'X-CSRF-Token': csrf}).status_code == 200
        assert client.post('/api/v1/analyze').status_code == 401
        assert client.post('/api/v1/analyze', headers={'X-API-Key': 'wrong'}).status_code == 401
        jury = client.post('/api/v1/analyze', headers={'X-API-Key': 'test-only-jury-key'})
        assert jury.status_code == 503
        assert jury.json()['error']['code'] == 'ML_NOT_CONFIGURED'
