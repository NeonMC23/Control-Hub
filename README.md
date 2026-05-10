# Control Hub

Local launcher (Windows/Linux) to start, stop, configure, and synchronize a suite of local Python applications from a single web UI.

## Prerequisites

- Python 3.10+ recommended
- 100% local (no cloud services)

## Installation

```bash
python -m venv .venv
```

### Windows (PowerShell)

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
```

### Linux/macOS

```bash
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
```

## Start

```bash
python start.py
```

Then open: `http://localhost:8000`

## Control Hub Logs

- File: `logs/control_hub.log`
- UI: toolbar button (filters INFO/WARNING/ERROR + clear)

## Add an application

- Fill the form:
  - Unique **ID** (e.g. `drifters`)
  - **Name**
  - **Script** (absolute path to `start.py` / `main.py`)
  - **Project root** (parent folder of the script)
  - **port.json** (file name, default `port.json`)
  - **launch_type**: `web` / `background` / `console` (via “Manage applications”)

## Manage applications

Toolbar button → table with edit / delete actions.

## Themes (Control Hub only)

- Active theme is stored in `backend/config/control_hub_themes.json`
- UI: settings button → select (dark/light/neon/matrix/solarized)

## Ports

- The port is read/written in `<project_root>/port.json` (key `port`).
- If the requested port is in use, Control Hub picks the next free port and updates `port.json`.

## Application logs

- Logs (stdout/stderr) are saved in `<project_root>/logs/<app_id>.log`
- The UI shows the latest lines (polling every 2s in the modal)
