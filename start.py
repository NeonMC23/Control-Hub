import os
import sys
import time
import signal
import subprocess
import webbrowser
from urllib.request import urlopen


def wait_http(url: str, timeout_s: float = 15.0, interval_s: float = 0.25) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with urlopen(url, timeout=2) as r:
                if 200 <= int(getattr(r, "status", 200)) < 500:
                    return True
        except Exception:
            time.sleep(interval_s)
    return False


def main() -> int:
    host = os.environ.get("CONTROL_HUB_HOST", "127.0.0.1")
    port = int(os.environ.get("CONTROL_HUB_PORT", "8000"))
    url = os.environ.get("CONTROL_HUB_URL", f"http://{host}:{port}")
    health = f"{url}/api/health"

    script_dir = os.path.dirname(os.path.abspath(__file__))
    cmd = [sys.executable, os.path.join(script_dir, "backend", "main.py")]
    proc = subprocess.Popen(cmd)

    def _stop_child(*_args):
        try:
            proc.terminate()
        except Exception:
            pass

    try:
        signal.signal(signal.SIGINT, _stop_child)
        signal.signal(signal.SIGTERM, _stop_child)
    except Exception:
        pass

    if wait_http(health, timeout_s=20.0):
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        return proc.wait()
    finally:
        _stop_child()


if __name__ == "__main__":
    raise SystemExit(main())
