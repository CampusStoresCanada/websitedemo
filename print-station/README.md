# CSC Print Station

Prints the check-in desk's queued stickers on a Brother QL (QL-1110NWB), straight
to the printer: each sticker at its exact length, cut between stickers.

Why not the browser's print dialog: the printer driver overrides each page's size
with its own paper, so a 120 mm sticker came out as two 100 mm pieces. Talking to
the printer directly (brother_ql, as last year's badge printer did) the length is
ours, and stickers line up with the card to fractions of a millimetre.

## On the conference laptop (Mac): the app

1. Copy **CSC Print Station.app** to the laptop (AirDrop the zip from `dist/`)
   and put it in Applications. Nothing else to install except Google Chrome
   (it draws each sticker with it): Python, the printer libraries and libusb
   are inside the app.
2. **First launch:** the app is not signed with an Apple developer ID, so macOS
   refuses a double-click. Right-click it → **Open** → **Open**. Once only.
3. Plug the QL in by USB, with the **62 mm continuous roll** loaded (DK-2113 clear).
4. On the desk: **Open the print station** → **Get a key** → **Copy**. Paste it
   into the app, **Save and start**. Printer: leave blank for USB.
5. Leave it open, plugged in and awake. The window shows each job as it prints;
   the desk's print station page shows it online within a few seconds.

**Change settings** switches key or printer (Cancel goes back). Settings live in
`~/.csc-print-station.json`, shared with the terminal version.

A printer problem (wrong roll, out of film, lid open) leaves the job in the
queue; it prints once fixed. A revoked key brings the app back to setup.

## Building the app

On a Mac with Homebrew: `brew install python-tk@3.14 libusb`, then
`./build_app.sh`. The app lands in `dist/` (about 40 MB, Apple Silicon). Zip it
to move it: `ditto -c -k --keepParent "dist/CSC Print Station.app" "dist/CSC Print Station.zip"`.

## Terminal version (still works)

Double-click **CSC Print Station.command** (needs Python 3, and on a fresh Mac
`brew install libusb`). Run with `--setup` to change settings.

## Windows (not yet built or tested)

The same app builds on Windows with PyInstaller (python.org Python includes Tk).
Use the network instead of USB, since Windows needs a special USB driver for
Python: at setup, give the printer as `tcp://PRINTER-IP:9100`. Edge is found
automatically.

## How it works

Every few seconds it checks in (`/api/print-station/heartbeat`), claims the oldest
queued job (`/claim`, atomic, so two stations never print one job), fetches each
sticker page (`/jobs/<id>/sticker` — the same document the desk's "Print now"
opens), pictures it with headless Chrome at 300 dpi, trims (never scales) to the
QL's 696 printable dots, and sends all of a job's stickers in one print with a cut
after each. Then it reports (`/jobs/<id>/result`). A claim nobody reports back on
returns to the queue after two minutes.
