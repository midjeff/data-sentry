"""Private Blob bytes and runtime-only calls to the internal signing service."""
import re
import httpx

from .errors import SentryError


class CloudStorage:
    def __init__(self, settings):
        self.settings = settings

    def signing_request(self, route, payload):
        # STORAGE_URL is injected by the binding on backend, never set by users.
        base = self.settings.storage_url
        secret = self.settings.internal_service_token.get_secret_value()
        if not base or not secret:
            raise SentryError('ARTIFACT_UNAVAILABLE', 503)
        try:
            response = httpx.post(base.rstrip('/') + '/' + route, json=payload,
                                  headers={'Authorization': f'Bearer {secret}'}, timeout=20)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise SentryError('ARTIFACT_UNAVAILABLE', 503) from None

    def upload_token(self, pathname, size):
        # ForteBank data locality has not been approved. No environment toggle
        # can authorize exporting competition video to cloud storage.
        raise SentryError('CLOUD_UPLOAD_NOT_APPROVED', 503)

    def read_url(self, pathname):
        return self.signing_request('read-url', {'pathname': pathname})['url']

    def head(self, pathname):
        from vercel.blob.sync import head_blob
        return head_blob(pathname)

    def read(self, pathname):
        from vercel.blob.sync import get_blob
        return get_blob(pathname, access='private').body

    def write(self, pathname, data, content_type):
        raise SentryError('CLOUD_UPLOAD_NOT_APPROVED', 503)

    def download(self, pathname, target, limit):
        from vercel.blob.sync import stream_blob
        size = 0
        with stream_blob(pathname, access='private') as download, target.open('xb') as output:
            for chunk in download:
                size += len(chunk)
                if size > limit:
                    raise SentryError('UPLOAD_TOO_LARGE', 413)
                output.write(chunk)
        if not size:
            raise SentryError('INVALID_UPLOAD', 422)
        return size

    def delete_job(self, job_id):
        from vercel.blob.sync import query_blobs, delete_blob
        for item in query_blobs(prefix=f'jobs/{job_id}/'):
            delete_blob(item.pathname)


def input_key(job):
    return f"jobs/{job['id']}/input{job['extension']}"


def result_prefix(job):
    ref = job['result_ref'] or ''
    if not re.fullmatch(r'attempts/[a-f0-9]{32}/final_result\.json', ref):
        raise SentryError('ARTIFACT_UNAVAILABLE', 503)
    return f"jobs/{job['id']}/{ref.rsplit('/', 1)[0]}"
