#!/bin/bash
# Double-click on a Mac to start the print station. First run sets itself up.
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "Setting up (first run only)…"
  python3 -m venv .venv && .venv/bin/pip install --quiet -r requirements.txt || { echo "Setup failed."; read -r; exit 1; }
fi
exec .venv/bin/python csc_print_station.py "$@"
