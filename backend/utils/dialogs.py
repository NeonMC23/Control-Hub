from __future__ import annotations

from pathlib import Path


def select_python_script(initial_dir: str | None = None) -> str | None:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception:
        return None

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        path = filedialog.askopenfilename(
            title="Select Python script",
            initialdir=initial_dir or str(Path.home()),
            filetypes=[("Python files", "*.py"), ("All files", "*.*")],
        )
        return path or None
    finally:
        try:
            root.destroy()
        except Exception:
            pass


def select_folder(initial_dir: str | None = None) -> str | None:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception:
        return None

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        path = filedialog.askdirectory(
            title="Select folder",
            initialdir=initial_dir or str(Path.home()),
        )
        return path or None
    finally:
        try:
            root.destroy()
        except Exception:
            pass

