#!/bin/bash
# Build "CSC Print Station.app" (Mac). Run on the machine that builds it, not the
# conference laptop: the app carries Python, the printer libraries and libusb.
# Needs: Homebrew python3 with Tk (brew install python-tk@3.14) and libusb
# (brew install libusb). The result is in ~/csc-print-station-build/dist/.
#
# PyMuPDF only renders Purolator's label PDFs here. Its optional layout
# add-on (onnxruntime and ~50 MB of models) took the zip to 110 MB, past the
# 50 MB storage limit for the download (2026-11-05), so it is left out.
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
  --collect-binaries pymupdf \
  --exclude-module pymupdf.layout \
  --exclude-module onnxruntime \
  "$PWD/print_station_app.py"
# ⛔ Opt out of App Nap: with the screen off, macOS paused the station's loop
# for three hours (2026-11-06) and it resumed only when someone clicked the
# window. Editing Info.plist breaks PyInstaller's signature, so sign again.
APP="$OUT/dist/CSC Print Station.app"
/usr/libexec/PlistBuddy -c "Add :NSAppSleepDisabled bool true" "$APP/Contents/Info.plist"
codesign --force --deep --sign - "$APP"
echo "Built: $APP"
