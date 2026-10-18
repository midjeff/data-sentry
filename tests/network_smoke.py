"""Windows harness for local Vite + API + mock worker; synthetic media only."""
import os
import argparse
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
DATA_ROOT = (BACKEND / "data").resolve()


def wait_ready(process, url, ready=lambda response: response.status_code == 200):
    end = time.monotonic() + 20
    while time.monotonic() < end:
        assert process.poll() is None, f"Owned process exited: {process.returncode}"
        try:
            if ready(httpx.get(url, timeout=1)):
                return
        except httpx.TransportError:
            pass
        time.sleep(0.1)
    raise AssertionError(f"Service not ready: {url}")


def stop(process):
    if process is not None:
        if process.poll() is None:
            process.terminate()
        process.wait(timeout=10)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    assert os.name == "nt", "This integration harness targets the Windows worker"
    parser = argparse.ArgumentParser()
    parser.add_argument("--isolated-ports", action="store_true", help="Use temporary ports without stopping existing development services")
    args = parser.parse_args()
    api_port, frontend_port = 8000, 5173
    if args.isolated_ports:
        with socket.socket() as api_socket, socket.socket() as frontend_socket:
            api_socket.bind(("127.0.0.1", 0))
            frontend_socket.bind(("127.0.0.1", 0))
            api_port, frontend_port = api_socket.getsockname()[1], frontend_socket.getsockname()[1]
    origin = f"http://localhost:{frontend_port}"
    api_base = f"http://127.0.0.1:{api_port}"
    for host, port in [("127.0.0.1", api_port), ("localhost", frontend_port)]:
        with socket.socket() as check:
            assert check.connect_ex((host, port)) != 0, f"Port {port} is already in use; stop the development service before running this test"
    assert DATA_ROOT.is_relative_to(ROOT.resolve())
    DATA_ROOT.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="stage2-test-", dir=DATA_ROOT) as temporary:
        directory = Path(temporary).resolve()
        assert directory.is_relative_to(DATA_ROOT)  # Before any automatic recursive temp cleanup.
        media = directory / "synthetic.mov"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=96x64:rate=10",
                        "-t", "1.2", "-c:v", "libx264", "-y", str(media)], check=True, timeout=15,
                       creationflags=subprocess.CREATE_NO_WINDOW)
        env = {**os.environ, "APP_ENV": "development", "PIPELINE_MODE": "mock", "COOKIE_SECURE": "false",
               "DATA_DIR": str(directory / "data"), "JOB_TIMEOUT_SEC": "20", "WORKER_STALE_SEC": "1",
               "ALLOWED_ORIGINS": f'["{origin}"]', "PYTHONIOENCODING": "utf-8"}
        api = vite = worker = None
        log_path = directory / "processes.log"
        with log_path.open("w", encoding="utf-8") as log:
            def launch(command, cwd):
                return subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                        creationflags=subprocess.CREATE_NO_WINDOW)
            try:
                api = launch([sys.executable, "-m", "uvicorn", "sentry.api:create_app", "--factory", "--host", "127.0.0.1", "--port", str(api_port)], BACKEND)
                vite_command = ([shutil.which("node"), "tests/vite_smoke.mjs", str(frontend_port), str(api_port)]
                                if args.isolated_ports else [shutil.which("node"), str(ROOT / "node_modules/vite/bin/vite.js")])
                vite = launch(vite_command, ROOT)
                wait_ready(api, f"{api_base}/health/live")
                wait_ready(vite, f"{origin}/")
                for scenario in ["violations", "no_violation", "failure"]:
                    env["MOCK_SCENARIO"] = scenario
                    worker = launch([sys.executable, "-m", "sentry.worker"], BACKEND)
                    wait_ready(worker, f"{api_base}/health/ready")
                    result = subprocess.run([shutil.which("node"), "tests/network_ui.mjs", scenario, str(media), str(frontend_port)],
                                            cwd=ROOT, check=True, timeout=45, creationflags=subprocess.CREATE_NO_WINDOW,
                                            capture_output=True, text=True, encoding="utf-8")
                    print(result.stdout.strip())
                    stop(worker); worker = None
                    # Let the old heartbeat expire; do not mutate the durable queue or readiness in this test.
                    time.sleep(1.1)
                relative_media = media.relative_to(ROOT).as_posix()
                private_paths = [
                    f"/{relative_media}", f"/{relative_media.upper()}",
                    f"/@fs/{media.as_posix()}", f"/{relative_media}?raw", "/backend/.venv/pyvenv.cfg",
                    "/backend/.env.example", "/backend/data/app.sqlite3", "/.git/config",
                ]
                with httpx.Client(base_url=origin) as client:
                    for path in private_paths:
                        response = client.get(path)
                        assert response.status_code in (403, 404), f"Private path was served: {path}, {response.status_code}"
                    assert client.get("/src/App.tsx").status_code == 200
                print("PASS Vite private-file restrictions, including /@fs and uppercase paths")
                stop(api); api = None
                result = subprocess.run([shutil.which("node"), "tests/network_ui.mjs", "offline", str(media), str(frontend_port)],
                                        cwd=ROOT, check=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW,
                                        capture_output=True, text=True, encoding="utf-8")
                print(result.stdout.strip())
            except Exception as error:
                log.flush()
                print(log_path.read_text(encoding="utf-8", errors="replace"), file=sys.stderr)
                if isinstance(error, subprocess.CalledProcessError):
                    print(error.stdout, error.stderr, file=sys.stderr)
                raise
            finally:
                stop(worker); stop(api); stop(vite)


if __name__ == "__main__":
    main()
