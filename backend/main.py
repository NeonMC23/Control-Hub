import os
import json
import time
import webbrowser
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, abort

from utils.process_manager import ProcessManager
from utils.paths import (
    BACKEND_DIR,
    ROOT_DIR,
    FRONTEND_DIR,
    CONFIG_DIR,
    LOGS_DIR,
    validate_project_root,
    validate_script_path,
)
from utils.port_manager import pick_free_port, read_port, write_port
from utils.dialogs import select_python_script, select_folder


def _read_json(path: Path, default):
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp.replace(path)


APPS_JSON = CONFIG_DIR / "apps.json"
CONTROL_HUB_THEMES_JSON = CONFIG_DIR / "control_hub_themes.json"
HUB_LOG_DIR = ROOT_DIR / "logs"
HUB_LOG_PATH = HUB_LOG_DIR / "control_hub.log"

app = Flask(
    __name__,
    static_folder=str(FRONTEND_DIR),
    static_url_path="",
)

process_manager = ProcessManager(LOGS_DIR)


class _StreamToLogger:
    def __init__(self, logger: logging.Logger, level: int):
        self.logger = logger
        self.level = level

    def write(self, message: str):
        msg = (message or "").rstrip()
        if msg:
            self.logger.log(self.level, msg)

    def flush(self):
        return


def _setup_control_hub_logging():
    HUB_LOG_DIR.mkdir(parents=True, exist_ok=True)

    handler = RotatingFileHandler(
        str(HUB_LOG_PATH),
        maxBytes=1024 * 1024,  # 1 MB
        backupCount=1,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter("%(asctime)s - [%(levelname)s] - %(message)s", "%Y-%m-%d %H:%M:%S"))

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.addHandler(handler)

    # Flask/Werkzeug logs
    try:
        app.logger.handlers.clear()
    except Exception:
        pass
    app.logger.addHandler(handler)
    app.logger.setLevel(logging.INFO)

    logging.getLogger("werkzeug").addHandler(handler)
    logging.getLogger("werkzeug").setLevel(logging.INFO)

    # Capture prints / tracebacks from the backend
    try:
        import sys

        sys.stdout = _StreamToLogger(logging.getLogger("stdout"), logging.INFO)
        sys.stderr = _StreamToLogger(logging.getLogger("stderr"), logging.ERROR)
    except Exception:
        pass

    app.logger.info("Control Hub logging initialized")


@app.get("/")
def index():
    return send_from_directory(str(FRONTEND_DIR), "index.html")


@app.get("/styles/<path:filename>")
def styles(filename: str):
    return send_from_directory(str(FRONTEND_DIR / "styles"), filename)


@app.get("/scripts/<path:filename>")
def scripts(filename: str):
    return send_from_directory(str(FRONTEND_DIR / "scripts"), filename)


@app.get("/api/health")
def api_health():
    return jsonify({"ok": True, "time": int(time.time())})


def _tail_lines(path: Path, tail_n: int) -> list[str]:
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
        return lines[-tail_n:]
    except Exception:
        return []


@app.get("/api/control_hub/logs")
def api_control_hub_logs_get():
    tail = request.args.get("tail", "800")
    level = (request.args.get("level") or "all").upper()
    try:
        tail_n = max(1, min(5000, int(tail)))
    except Exception:
        tail_n = 800
    lines = _tail_lines(HUB_LOG_PATH, tail_n)
    if level != "ALL":
        lines = [ln for ln in lines if f"[{level}]" in ln]
    return jsonify({"ok": True, "lines": lines, "log_path": str(HUB_LOG_PATH)})


@app.delete("/api/control_hub/logs")
def api_control_hub_logs_clear():
    HUB_LOG_DIR.mkdir(parents=True, exist_ok=True)
    with HUB_LOG_PATH.open("w", encoding="utf-8") as f:
        f.write("")
    app.logger.info("Control Hub logs cleared")
    return jsonify({"ok": True})


@app.get("/api/config/paths")
def api_paths():
    return jsonify(
        {
            "root_dir": str(ROOT_DIR),
            "logs_dir": str(LOGS_DIR),
        }
    )


def _load_apps():
    return _read_json(APPS_JSON, {})


def _save_apps(apps: dict):
    _write_json(APPS_JSON, apps)


@app.get("/api/apps")
def api_apps_list():
    apps = _load_apps()
    return jsonify(apps)


@app.get("/api/apps/<app_id>")
def api_app_get(app_id: str):
    apps = _load_apps()
    if app_id not in apps:
        abort(404, description="Unknown app id")
    return jsonify(apps[app_id])


@app.post("/api/apps")
def api_apps_add():
    payload = request.get_json(force=True, silent=False) or {}
    app_id = (payload.get("id") or "").strip()
    name = (payload.get("name") or "").strip()
    script_path = (payload.get("script_path") or "").strip()
    project_root = (payload.get("project_root") or "").strip()
    port_file = (payload.get("port_file") or "port.json").strip() or "port.json"
    auto_launch = bool(payload.get("auto_launch", False))
    launch_type = (payload.get("launch_type") or "web").strip().lower() or "web"

    if not app_id:
        abort(400, description="Missing 'id'")
    if not name:
        abort(400, description="Missing 'name'")
    if not script_path:
        abort(400, description="Missing 'script_path'")
    if not project_root:
        abort(400, description="Missing 'project_root'")

    script_p = validate_script_path(script_path)
    root_p = validate_project_root(project_root)
    if root_p not in script_p.parents and script_p.parent != root_p:
        abort(400, description="script_path must be inside project_root")

    apps = _load_apps()
    if app_id in apps:
        abort(409, description="App id already exists")

    apps[app_id] = {
        "name": name,
        "script_path": str(script_p),
        "project_root": str(root_p),
        "port_file": port_file,
        "auto_launch": auto_launch,
        "launch_type": launch_type,
    }
    _save_apps(apps)
    return jsonify({"ok": True, "app_id": app_id})


@app.put("/api/apps/<app_id>")
def api_apps_update(app_id: str):
    payload = request.get_json(force=True, silent=False) or {}
    apps = _load_apps()
    if app_id not in apps:
        abort(404, description="Unknown app id")

    current = apps[app_id]
    if "name" in payload:
        current["name"] = (payload.get("name") or "").strip() or current["name"]
    if "script_path" in payload:
        script_p = validate_script_path((payload.get("script_path") or "").strip())
        current["script_path"] = str(script_p)
    if "project_root" in payload:
        root_p = validate_project_root((payload.get("project_root") or "").strip())
        current["project_root"] = str(root_p)
    if "port_file" in payload:
        current["port_file"] = (payload.get("port_file") or "port.json").strip() or "port.json"
    if "launch_type" in payload:
        current["launch_type"] = (payload.get("launch_type") or "web").strip().lower() or "web"
    if "auto_launch" in payload:
        current["auto_launch"] = bool(payload.get("auto_launch"))

    apps[app_id] = current
    _save_apps(apps)
    return jsonify({"ok": True})


@app.delete("/api/apps/<app_id>")
def api_apps_delete(app_id: str):
    apps = _load_apps()
    if app_id not in apps:
        abort(404, description="Unknown app id")
    # Stop if running
    process_manager.stop(app_id)
    del apps[app_id]
    _save_apps(apps)
    return jsonify({"ok": True})


@app.get("/api/apps/status")
def api_apps_status_all():
    apps = _load_apps()
    status = {}
    for app_id, cfg in apps.items():
        desired_port = None
        try:
            project_root = Path(cfg.get("project_root") or "")
            if project_root.exists() and (cfg.get("launch_type") or "web").strip().lower() == "web":
                port_cfg = read_port(project_root, cfg.get("port_file") or "port.json")
                desired_port = port_cfg.get("port")
        except Exception:
            desired_port = None
        st = process_manager.status(app_id, desired_port)
        st["desired_port"] = desired_port
        status[app_id] = st
    return jsonify(status)


@app.post("/api/apps/<app_id>/launch")
def api_apps_launch(app_id: str):
    apps = _load_apps()
    if app_id not in apps:
        abort(404, description="Unknown app id")
    cfg = apps[app_id]

    if process_manager.is_running(app_id):
        return jsonify({"ok": True, "already_running": True, **process_manager.status(app_id, None)})

    script_path = validate_script_path(cfg.get("script_path") or "")
    project_root = validate_project_root(cfg.get("project_root") or "")
    if project_root not in script_path.parents and script_path.parent != project_root:
        abort(400, description="script_path must be inside project_root")

    launch_type = (cfg.get("launch_type") or "web").strip().lower()
    chosen_port = None
    if launch_type == "web":
        port_cfg = read_port(project_root, cfg.get("port_file") or "port.json")
        desired_port = int(port_cfg.get("port", 5000))
        chosen_port = pick_free_port(desired_port)
        write_port(project_root, cfg.get("port_file") or "port.json", chosen_port)

    env = {
        "CONTROL_HUB_APP_ID": app_id,
        "CONTROL_HUB_LAUNCH_TYPE": launch_type,
        "CONTROL_HUB_APP_PORT_JSON": str(project_root / (cfg.get("port_file") or "port.json")),
        "PYTHONUNBUFFERED": "1",
    }
    if chosen_port is not None:
        env["CONTROL_HUB_PORT"] = str(chosen_port)

    log_path = project_root / "logs" / f"{app_id}.log"
    proc = process_manager.launch(
        app_id=app_id,
        script_path=script_path,
        cwd=project_root,
        port=chosen_port,
        log_path=log_path,
        env=env,
    )

    url = f"http://localhost:{chosen_port}" if chosen_port is not None else None
    # Default: do NOT open the browser (apps may handle this themselves).
    if request.args.get("open", "0") == "1":
        try:
            if url:
                webbrowser.open(url)
        except Exception:
            pass

    return jsonify({"ok": True, "pid": proc.pid, "port": chosen_port, "url": url})


@app.post("/api/apps/<app_id>/stop")
def api_apps_stop(app_id: str):
    stopped = process_manager.stop(app_id)
    return jsonify({"ok": True, "stopped": stopped})


@app.get("/api/apps/<app_id>/logs")
def api_apps_logs(app_id: str):
    apps = _load_apps()
    if app_id not in apps:
        abort(404, description="Unknown app id")
    tail = request.args.get("tail", "300")
    try:
        tail_n = max(1, min(5000, int(tail)))
    except Exception:
        tail_n = 300
    cfg = apps[app_id]
    project_root = Path(cfg.get("project_root") or "")
    log_path = project_root / "logs" / f"{app_id}.log"
    return jsonify({"ok": True, "lines": process_manager.tail_path(log_path, tail_n), "log_path": str(log_path)})


@app.get("/api/apps/<app_id>/port")
def api_app_port_get(app_id: str):
    apps = _load_apps()
    if app_id not in apps:
        abort(404, description="Unknown app id")
    cfg = apps[app_id]
    if (cfg.get("launch_type") or "web").strip().lower() != "web":
        abort(400, description="Port is only applicable for launch_type=web")
    project_root = validate_project_root(cfg.get("project_root") or "")
    data = read_port(project_root, cfg.get("port_file") or "port.json")
    return jsonify({"ok": True, "data": data})


@app.put("/api/apps/<app_id>/port")
def api_app_port_set(app_id: str):
    apps = _load_apps()
    if app_id not in apps:
        abort(404, description="Unknown app id")
    payload = request.get_json(force=True, silent=False) or {}
    port = payload.get("port")
    if not isinstance(port, int):
        abort(400, description="Invalid port")
    cfg = apps[app_id]
    if (cfg.get("launch_type") or "web").strip().lower() != "web":
        abort(400, description="Port is only applicable for launch_type=web")
    project_root = validate_project_root(cfg.get("project_root") or "")
    desired = int(port)
    chosen = pick_free_port(desired)
    write_port(project_root, cfg.get("port_file") or "port.json", chosen)
    return jsonify({"ok": True, "port": chosen, "requested": desired, "changed": chosen != desired})


@app.post("/api/dialog/select_script")
def api_dialog_select_script():
    initial = request.args.get("initial", None)
    path = select_python_script(initial)
    if not path:
        abort(400, description="File dialog unavailable or canceled")
    return jsonify({"ok": True, "path": path})


@app.post("/api/dialog/select_folder")
def api_dialog_select_folder():
    initial = request.args.get("initial", None)
    path = select_folder(initial)
    if not path:
        abort(400, description="Folder dialog unavailable or canceled")
    return jsonify({"ok": True, "path": path})


def ensure_default_configs():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    HUB_LOG_DIR.mkdir(parents=True, exist_ok=True)
    if not HUB_LOG_PATH.exists():
        with HUB_LOG_PATH.open("a", encoding="utf-8"):
            pass

    if not APPS_JSON.exists():
        _write_json(APPS_JSON, {})

    if not CONTROL_HUB_THEMES_JSON.exists():
        _write_json(CONTROL_HUB_THEMES_JSON, {"active_theme": "dark"})


def auto_launch_apps():
    apps = _load_apps()
    for app_id, cfg in apps.items():
        if not cfg.get("auto_launch"):
            continue
        try:
            script_path = validate_script_path(cfg.get("script_path") or "")
            project_root = validate_project_root(cfg.get("project_root") or "")
            port_cfg = read_port(project_root, cfg.get("port_file") or "port.json")
            desired_port = int(port_cfg.get("port", 5000))
            chosen_port = pick_free_port(desired_port)
            write_port(project_root, cfg.get("port_file") or "port.json", chosen_port)
            env = {
                "CONTROL_HUB_APP_ID": app_id,
                "CONTROL_HUB_PORT": str(chosen_port),
                "CONTROL_HUB_APP_PORT_JSON": str(project_root / (cfg.get("port_file") or "port.json")),
                "PYTHONUNBUFFERED": "1",
            }
            log_path = project_root / "logs" / f"{app_id}.log"
            process_manager.launch(
                app_id=app_id,
                script_path=script_path,
                cwd=project_root,
                port=chosen_port,
                log_path=log_path,
                env=env,
            )
        except Exception:
            continue


def main():
    ensure_default_configs()
    _setup_control_hub_logging()
    auto_launch_apps()
    host = os.environ.get("CONTROL_HUB_HOST", "127.0.0.1")
    port = int(os.environ.get("CONTROL_HUB_PORT", "8000"))
    app.logger.info("Server starting on %s:%s", host, port)
    app.run(host=host, port=port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
