# CSC Print Station

Prints the check-in desk's queued stickers on a Brother QL (QL-1110NWB), straight
to the printer: each sticker at its exact length, cut between stickers.

Why not the browser's print dialog: the printer driver overrides each page's size
with its own paper, so a 120 mm sticker came out as two 100 mm pieces. Talking to
the printer directly (brother_ql, as last year's badge printer did) the length is
ours, and stickers line up with the card to fractions of a millimetre.

## On the conference laptop (Mac): the app

1. In the War Room: **What's next** → **Open the print station** → **Download CSC
   Print Station for Mac** (or AirDrop the zip from `dist/`). Unzip it and put
   it in Applications. Nothing else to install except Google Chrome
   (it draws each sticker with it): Python, the printer libraries and libusb
   are inside the app.
2. **First launch:** the app is not signed with an Apple developer ID, so macOS
   refuses a double-click. Right-click it → **Open** → **Open**. Once only.
3. Plug the QL in by USB, with the **62 mm continuous roll** loaded (DK-2113 clear).
4. On the same page: **Get a key** → **Copy**. It is shown once. Paste it into
   the app, **Save and start**. Printer: leave blank for USB.
5. Leave it open, plugged in and awake. The window shows each job as it prints;
   the print station page shows it online within a few seconds.

**Change settings** switches key or printer (Cancel goes back). Settings live in
`~/.csc-print-station.json`, shared with the terminal version.

A printer problem (wrong roll, out of film, lid open) leaves the job in the
queue; it prints once fixed. A revoked key brings the app back to setup.

## Documents (speeches, run-sheets)

A document attached to a War Room task has **Send to printer**. It goes on the same
queue; this laptop fetches it as a PDF and prints it on its ordinary paper printer
(`lp`, so any printer the Mac can already print to). The app always uses the Mac's
default printer; the terminal version asks at `--setup`, blank meaning the default.

- A Google Doc must be shared as **anyone with the link can view**, or Google
  answers with a sign-in page and the job fails saying so. An uploaded file must be
  a PDF.
- An older copy of this app never receives documents; update it to print them.
- Mac and Linux only for now.

## Shipping labels (the shipping desk)

Shipments booked at the shipping desk queue their Purolator labels here, one 4×6
label per box. They print on the **same QL**, on the **DK-1247 die-cut roll
(103 × 164 mm)**, so they wait until you are ready:

1. Swap the QL to the DK-1247 roll.
2. War Room → Print → Shipping labels → **Print the shipping labels**.
3. When they're out, swap the 62 mm badge roll back.

If the badge roll is still in, the printer refuses them and they go back to
waiting (the War Room says how many); swap the roll and press the button again.
Badge stickers sent while the die-cut roll is in wait the same way until the 62 mm
roll is back. An older copy of this app never receives shipping labels; rebuild it
(it needs `brother_ql_next` and `pymupdf`, both in requirements.txt).

To prove at the dry run: the label sits square on the die-cut label, and a phone
scans its barcode.

## Building the app

On a Mac with Homebrew: `brew install python-tk@3.14 libusb`, then
`./build_app.sh`. The app lands in `~/csc-print-station-build/dist/`, outside the
repo on purpose: an app bundle inside the website's folder breaks `next build`.
Zip it to move it: `ditto -c -k --keepParent ~/csc-print-station-build/dist/"CSC Print Station.app" ~/csc-print-station-build/dist/"CSC Print Station.zip"`.

**Publish it** so the print station page's "Download CSC Print Station for Mac"
link serves the new build (private storage, a link made per visit):
`npx tsx scripts/upload-print-station-app.mts` from the repo root.

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
