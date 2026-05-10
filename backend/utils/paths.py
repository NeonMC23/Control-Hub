from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
FRONTEND_DIR = ROOT_DIR / "frontend"
CONFIG_DIR = BACKEND_DIR / "config"
LOGS_DIR = BACKEND_DIR / "logs"


def validate_script_path(script_path: str) -> Path:
    p = Path(script_path)
    if not p.is_absolute():
        raise ValueError("script_path must be an absolute path")
    if p.suffix.lower() != ".py":
        raise ValueError("script_path must point to a .py file")
    if not p.exists() or not p.is_file():
        raise ValueError("script_path does not exist or is not a file")
    return p


def validate_project_root(project_root: str) -> Path:
    p = Path(project_root)
    if not p.is_absolute():
        raise ValueError("project_root must be an absolute path")
    if not p.exists() or not p.is_dir():
        raise ValueError("project_root does not exist or is not a directory")
    return p
