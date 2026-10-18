"""Controlled test doubles; never imported by deployable application code."""
import os
import subprocess
import sys
import time

from sentry.adapters import MockPipelineAdapter
from sentry.errors import SentryError
from sentry.worker import Worker


class FileStop:
    """Crash-safe test stop signal; no shared semaphore owned by a killed process."""
    def __init__(self, path):
        self.path = path

    def is_set(self):
        return self.path.exists()

    def set(self):
        self.path.touch()

    def wait(self, seconds):
        time.sleep(seconds)
        return self.is_set()


class ReadyDecisionAdapter(MockPipelineAdapter):
    def analyze(self, request):
        result = super().analyze(request)
        return result.model_copy(update={"is_demo": False, "provenance": "controlled-test-double"})


class LifecycleAdapter(MockPipelineAdapter):
    def __init__(self, settings):
        super().__init__(settings)
        self.root = settings.data_dir

    def initialize(self):
        with (self.root / "initializations.txt").open("a") as stream:
            stream.write(f"{os.getpid()}\n")

    def analyze(self, request):
        action_path = request.artifacts_dir / "test-action"
        action = action_path.read_text() if action_path.exists() else "success"
        if action == "fail":
            raise SentryError("PIPELINE_FAILED")
        if action == "crash":
            os._exit(17)
        if action == "hang":
            child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"],
                                     creationflags=subprocess.CREATE_NO_WINDOW)
            (request.artifacts_dir / "descendant.pid").write_text(str(child.pid))
            while True:
                time.sleep(0.1)
        return super().analyze(request)


def run_worker(settings, stop_event):
    Worker(settings, LifecycleAdapter).run(stop_event)
