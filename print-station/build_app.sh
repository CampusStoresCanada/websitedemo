#!/bin/bash
# Build "CSC Print Station.app" (Mac). Run on the machine that builds it, not the
# conference laptop: the app carries Python, the printer libraries and libusb.
# Needs: Homebrew python3 with Tk (brew install python-tk@3.14) and libusb
# (brew install libusb). The result is in dist/.
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install --quiet -r requirements.txt pyinstaller
LIBUSB="$(brew --prefix libusb)/lib/libusb-1.0.0.dylib"
.venv/bin/pyinstaller --noconfirm --clean --windowed \
  --name "CSC Print Station" \
  --osx-bundle-identifier ca.campusstores.printstation \
  --add-binary "$LIBUSB:." \
  --collect-submodules brother_ql \
  --collect-submodules usb \
  print_station_app.py
echo "Built: dist/CSC Print Station.app"
