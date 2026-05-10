# Control Hub

Launcher local (Windows/Linux) pour démarrer, arrêter, configurer et synchroniser une suite d’applications Python depuis une interface web.

## Prérequis

- Python 3.10+ recommandé
- Accès local (aucun service cloud)

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

## Démarrage

```bash
python start.py
```

Puis ouvrir: `http://localhost:8000`

## Ajouter une application

- Renseigne dans l’UI:
  - **ID** unique (ex: `drifters`)
  - **Nom**
  - **Script** (chemin absolu vers `start.py` / `main.py`)
  - **Racine du projet** (dossier parent du script)
  - **port.json** (nom du fichier, par défaut `port.json`)
  - **theme.json** (nom du fichier, par défaut `theme.json`)

## Thèmes

Le système de thèmes a été retiré (non nécessaire).

## Ports

- Le port est lu/écrit dans `<project_root>/port.json` (clé `port`).
- Si le port demandé est occupé, Control Hub choisit le prochain port libre et met à jour `port.json`.

## Logs

- Les logs (stdout/stderr) sont enregistrés dans `<project_root>/logs/<app_id>.log`
- L’UI affiche les dernières lignes (polling toutes les 2s dans la modale)
