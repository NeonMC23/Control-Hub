import os
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class ProcInfo:
    popen: "subprocess.Popen"
    port: Optional[int]
    started_at: int
    log_path: Path


class ProcessManager:
    def __init__(self, logs_dir: Path):
        self.logs_dir = Path(logs_dir)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._procs: dict[str, ProcInfo] = {}

    def _default_log_path(self, app_id: str) -> Path:
        safe = "".join(c for c in app_id if c.isalnum() or c in ("-", "_")).strip("_-") or "app"
        return self.logs_dir / f"{safe}.log"

    def log_line(self, app_id: str, line: str, log_path: Path | None = None):
        path = Path(log_path) if log_path else self._default_log_path(app_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        with path.open("a", encoding="utf-8", errors="replace") as f:
            f.write(f"{ts} {line}\n")

    def launch(
        self,
        app_id: str,
        script_path: Path,
        cwd: Path,
        port: Optional[int],
        log_path: Path,
        env: dict,
    ) -> "subprocess.Popen":
        import subprocess

        with self._lock:
            if app_id in self._procs and self._procs[app_id].popen.poll() is None:
                return self._procs[app_id].popen

            script_path = Path(script_path)
            cwd = Path(cwd)
            log_path = Path(log_path)
            log_path.parent.mkdir(parents=True, exist_ok=True)

            merged_env = os.environ.copy()
            merged_env.update({k: str(v) for k, v in (env or {}).items()})

            cmd = [sys.executable, str(script_path)]
            self.log_line(app_id, f"[control-hub] Launching: {' '.join(cmd)} (port={port})", log_path=log_path)
            popen = subprocess.Popen(
                cmd,
                cwd=str(cwd),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=merged_env,
                bufsize=1,
            )

            info = ProcInfo(
                popen=popen,
                port=int(port) if port is not None else None,
                started_at=int(time.time()),
                log_path=log_path,
            )
            self._procs[app_id] = info

            self._start_reader(app_id, popen.stdout, prefix="[stdout] ", log_path=log_path)
            self._start_reader(app_id, popen.stderr, prefix="[stderr] ", log_path=log_path)
            self._start_exit_watcher(app_id)
            return popen

    def _start_reader(self, app_id: str, stream, prefix: str, log_path: Path):
        if stream is None:
            return

        def _run():
            try:
                for line in stream:
                    self.log_line(app_id, prefix + line.rstrip("\n"), log_path=log_path)
            except Exception as e:
                self.log_line(app_id, f"[control-hub] log reader error: {e}", log_path=log_path)

        threading.Thread(target=_run, daemon=True).start()

    def _start_exit_watcher(self, app_id: str):
        def _run():
            while True:
                with self._lock:
                    info = self._procs.get(app_id)
                if not info:
                    return
                rc = info.popen.poll()
                if rc is None:
                    time.sleep(0.5)
                    continue
                self.log_line(app_id, f"[control-hub] Process exited with code {rc}", log_path=info.log_path)
                return

        threading.Thread(target=_run, daemon=True).start()

    def is_running(self, app_id: str) -> bool:
        with self._lock:
            info = self._procs.get(app_id)
        return bool(info and info.popen.poll() is None)

    def stop(self, app_id: str) -> bool:
        with self._lock:
            info = self._procs.get(app_id)
        if not info:
            return False
        popen = info.popen
        if popen.poll() is not None:
            return False
        try:
            self.log_line(app_id, "[control-hub] Stopping...", log_path=info.log_path)
            popen.terminate()
            try:
                popen.wait(timeout=5)
            except Exception:
                popen.kill()
        except Exception as e:
            self.log_line(app_id, f"[control-hub] stop error: {e}", log_path=info.log_path)
            return False
        return True

    def status(self, app_id: str, configured_port: Optional[int] = None) -> dict:
        with self._lock:
            info = self._procs.get(app_id)
        if not info:
            return {"running": False, "pid": None, "port": configured_port, "started_at": None}
        running = info.popen.poll() is None
        return {
            "running": running,
            "pid": info.popen.pid,
            "port": info.port,
            "started_at": info.started_at,
        }

    def tail_path(self, path: Path, lines: int = 200) -> list[str]:
        path = Path(path)
        if not path.exists():
            return []
        try:
            with path.open("r", encoding="utf-8", errors="replace") as f:
                data = f.read().splitlines()
            return data[-lines:]
        except Exception:
            return []
