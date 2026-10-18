"""Private queue boundary. Inference is reserved for the local GPU computer."""
import asyncio

from vercel.queue import subscribe

from .cloud_db import CloudDatabase
from .cloud_uploads import TOPIC
from .config import Settings


async def consume(payload, settings, db):
    # Keep duplicate/attempt fencing, but reject pending work without fetching
    # video, importing an ML adapter, or running inference in a Vercel Function.
    # PIPELINE_MODE=real cannot bypass this boundary. GPU integration is pending.
    job = await asyncio.to_thread(db.claim_delivery, payload['job_id'], payload['attempt'])
    if job is None:
        return
    try:
        await asyncio.to_thread(db.fail, job['id'], 'ML_NOT_CONFIGURED', job['worker_id'])
    finally:
        await asyncio.to_thread(db.release_delivery, job['id'], job['worker_id'])


@subscribe(topic=TOPIC, consumer_group='sentry-analysis-v1', max_concurrency=1)
async def analyze(payload: dict[str, str | int]) -> None:
    settings = Settings.for_vercel()
    await consume(payload, settings, CloudDatabase(settings))
