import json
import socket
from datetime import datetime, timezone
from pathlib import Path


def _read_json(path: Path, default):
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp.replace(path)


def is_port_free(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, int(port)))
            return True
        except OSError:
            return False


def pick_free_port(desired_port: int, host: str = "127.0.0.1", max_tries: int = 50) -> int:
    port = int(desired_port)
    for _ in range(max_tries):
        if is_port_free(port, host=host):
            return port
        port += 1
    raise RuntimeError("No free port found")


def port_file_path(project_root: Path, port_file: str) -> Path:
    return Path(project_root) / (port_file or "port.json")


def read_port(project_root: Path, port_file: str = "port.json") -> dict:
    path = port_file_path(project_root, port_file)
    return _read_json(path, {"port": 5000})


def write_port(project_root: Path, port_file: str, port: int) -> Path:
    path = port_file_path(project_root, port_file)
    data = {
        "port": int(port),
        "last_used": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    _write_json(path, data)
    return path

