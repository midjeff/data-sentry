"""Vercel ASGI entrypoint; importing this module never opens a database connection."""
from sentry.api import create_app
from sentry.config import Settings

app = create_app(Settings.for_vercel())
