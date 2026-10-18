import json
from pathlib import Path
import runpy

import pytest
from fastapi.testclient import TestClient

from sentry.config import Settings


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for name in ('VERCEL_ENV', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL',
                 'VERCEL_BRANCH_URL', 'ALLOWED_ORIGINS', 'PIPELINE_MODE'):
        monkeypatch.delenv(name, raising=False)


def test_production_allows_only_canonical_domain(monkeypatch):
    monkeypatch.setenv('VERCEL_ENV', 'production')
    monkeypatch.setenv('VERCEL_PROJECT_PRODUCTION_URL', 'sentry.example.com')
    monkeypatch.setenv('VERCEL_URL', 'sentry-hash-team.vercel.app')
    monkeypatch.setenv('VERCEL_BRANCH_URL', 'sentry-git-main-team.vercel.app')
    settings = Settings.for_vercel()
    assert settings.allowed_origins == ['https://sentry.example.com']
    assert settings.cookie_secure and settings.app_env == 'production'


def test_preview_allows_only_exact_platform_origins(monkeypatch):
    monkeypatch.setenv('VERCEL_ENV', 'preview')
    monkeypatch.setenv('VERCEL_PROJECT_PRODUCTION_URL', 'sentry.example.com')
    monkeypatch.setenv('VERCEL_URL', 'sentry-hash-team.vercel.app')
    monkeypatch.setenv('VERCEL_BRANCH_URL', 'sentry-git-feature-team.vercel.app')
    settings = Settings.for_vercel()
    assert settings.allowed_origins == ['https://sentry.example.com',
                                       'https://sentry-hash-team.vercel.app',
                                       'https://sentry-git-feature-team.vercel.app']
    assert settings.cookie_secure
    monkeypatch.setenv('ALLOWED_ORIGINS', '["https://sentry-hash-team.vercel.app"]')
    assert Settings.for_vercel().allowed_origins == ['https://sentry-hash-team.vercel.app']


@pytest.mark.parametrize('origin', ['*', 'https://*.vercel.app', 'https://unrelated.vercel.app',
                                   'http://localhost:5173', 'https://sentry.example.com.evil.test'])
def test_hosted_override_cannot_expand_allowlist(monkeypatch, origin):
    monkeypatch.setenv('VERCEL_ENV', 'preview')
    monkeypatch.setenv('VERCEL_PROJECT_PRODUCTION_URL', 'sentry.example.com')
    monkeypatch.setenv('ALLOWED_ORIGINS', json.dumps([origin]))
    with pytest.raises(ValueError):
        Settings.for_vercel()


@pytest.mark.parametrize('host', ['*.vercel.app', 'localhost', 'app.localhost', '127.0.0.1',
                                 'user@app.vercel.app', 'app.vercel.app/path', 'https://app.vercel.app'])
def test_malformed_platform_origin_rejected(monkeypatch, host):
    monkeypatch.setenv('VERCEL_PROJECT_PRODUCTION_URL', host)
    with pytest.raises(ValueError):
        Settings.for_vercel()


def test_missing_platform_origins_fail_closed():
    assert Settings.for_vercel().allowed_origins == []


def test_localhost_is_development_only(monkeypatch):
    monkeypatch.setenv('VERCEL_ENV', 'development')
    monkeypatch.setenv('ALLOWED_ORIGINS', '["http://localhost:3000"]')
    settings = Settings.for_vercel()
    assert settings.allowed_origins == ['http://localhost:3000']
    assert not settings.cookie_secure
    monkeypatch.setenv('VERCEL_ENV', 'production')
    with pytest.raises(ValueError):
        Settings.for_vercel()


@pytest.mark.parametrize('origin', ['http://app.example.com', 'https://localhost',
                                   'https://127.0.0.1', 'https://[::1]'])
def test_non_vercel_production_also_rejects_localhost_and_http(tmp_path, origin):
    with pytest.raises(ValueError):
        Settings(_env_file=None, data_dir=tmp_path, app_env='production', cookie_secure=True,
                 allowed_origins=[origin])


def test_production_and_preview_never_enable_mock(monkeypatch):
    monkeypatch.setenv('PIPELINE_MODE', 'mock')
    for environment in ('production', 'preview'):
        monkeypatch.setenv('VERCEL_ENV', environment)
        with pytest.raises(ValueError):
            Settings.for_vercel()


@pytest.mark.parametrize('configured,platform_domain', [
    ('["http://localhost:5173"]', 'data-sentry-ai.vercel.app'),
    ('["https://data-sentry-ai.vercel.app"]', None),
    ('"https://data-sentry-ai.vercel.app"', 'data-sentry-ai.vercel.app'),
])
def test_production_entrypoint_origin_conflict_and_configuration_recovery(monkeypatch, configured, platform_domain):
    # Reproduce the supplied Vercel traceback at import, before any DB/storage I/O.
    monkeypatch.setenv('VERCEL_ENV', 'production')
    monkeypatch.setenv('ALLOWED_ORIGINS', configured)
    if platform_domain:
        monkeypatch.setenv('VERCEL_PROJECT_PRODUCTION_URL', platform_domain)
    monkeypatch.setattr('psycopg.connect', lambda *_args, **_kwargs: pytest.fail('Unexpected DB I/O'))
    monkeypatch.setattr('sentry.cloud_storage.CloudStorage.signing_request',
                        lambda *_args: pytest.fail('Unexpected storage I/O'))
    entrypoint = str(Path(__file__).parents[1] / 'main.py')
    with pytest.raises(ValueError, match='Hosted ALLOWED_ORIGINS may only restrict'):
        runpy.run_path(entrypoint)
    # Dashboard remedy: restore platform variables and remove the conflicting
    # optional override. No security bypass or request-derived origin is needed.
    monkeypatch.setenv('VERCEL_PROJECT_PRODUCTION_URL', 'data-sentry-ai.vercel.app')
    monkeypatch.delenv('ALLOWED_ORIGINS')
    app = runpy.run_path(entrypoint)['app']
    assert app.state.settings.allowed_origins == ['https://data-sentry-ai.vercel.app']
    assert app.state.settings.cookie_secure
    with TestClient(app) as client:
        assert client.get('/api/health/live').status_code == 200
        assert client.post('/api/ui/session', headers={'Origin': 'https://unrelated.vercel.app'}).status_code == 403
