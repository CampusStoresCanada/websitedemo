#!/bin/bash
# Build "CSC Print Station.app" (Mac). Run on the machine that builds it, not the
# conference laptop: the app carries Python, the printer libraries and libusb.
# Needs: Homebrew python3 with Tk (brew install python-tk@3.14) and libusb
# (brew install libusb). The result is in ~/csc-print-station-build/dist/.
#
# ⛔ Built OUTSIDE the repo: an .app bundle or a venv inside the website's
# folder makes `next build` fail ("Invalid file type Directory", 2026-11-04).
set -euo pipefail
cd "$(dirname "$0")"
OUT="${CSC_PRINT_STATION_BUILD:-$HOME/csc-print-station-build}"
mkdir -p "$OUT"
if [ ! -x "$OUT/.venv/bin/python" ]; then
  python3 -m venv "$OUT/.venv"
fi
"$OUT/.venv/bin/pip" install --quiet -r requirements.txt pyinstaller
LIBUSB="$(brew --prefix libusb)/lib/libusb-1.0.0.dylib"
"$OUT/.venv/bin/pyinstaller" --noconfirm --clean --windowed \
  --distpath "$OUT/dist" --workpath "$OUT/build" --specpath "$OUT" \
  --name "CSC Print Station" \
  --osx-bundle-identifier ca.campusstores.printstation \
  --add-binary "$LIBUSB:." \
  --collect-submodules brother_ql \
  --collect-submodules usb \
  --collect-all pymupdf \
  "$PWD/print_station_app.py"
echo "Built: $OUT/dist/CSC Print Station.app"
