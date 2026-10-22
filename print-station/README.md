# CSC Print Station

Prints the check-in desk's queued stickers on a Brother QL (QL-1110NWB), straight
to the printer: each sticker at its exact length, cut between stickers.

Why not the browser's print dialog: the printer driver overrides each page's size
with its own paper, so a 120 mm sticker came out as two 100 mm pieces. Talking to
the printer directly (brother_ql, as last year's badge printer did) the length is
ours, and stickers line up with the card to fractions of a millimetre.

## On the conference laptop (Mac)

1. Plug the QL in by USB, with the **62 mm continuous roll** loaded (DK-2113 clear).
2. In the War Room: **What's next** → **Open the print station** → **Get a key**. It is shown once.
3. Double-click **CSC Print Station.command**. The first run sets itself up (needs
   Python 3 and internet), then asks for the website address and the key.
4. Leave it running, plugged in and awake. The desk's print station page shows it
   online within a few seconds.

Any desk device then taps **Send to print queue** on a reprint, and it prints here.

- Needs Google Chrome (or Microsoft Edge) installed: it draws each sticker with it.
- USB needs libusb on a fresh Mac: `brew install libusb`.
- Settings live in `~/.csc-print-station.json`. Run with `--setup` to change them.
- A printer problem (wrong roll, out of film, lid open) leaves the job in the queue;
  it prints once fixed. The desk's print station page shows what the printer said.

## Windows (not yet tested)

Use the network instead of USB (Windows needs a special USB driver for Python):
at setup, give the printer as `tcp://PRINTER-IP:9100`. Edge is found automatically.

## How it works

Every few seconds it checks in (`/api/print-station/heartbeat`), claims the oldest
queued job (`/claim`, atomic, so two stations never print one job), fetches each
sticker page (`/jobs/<id>/sticker` — the same document the desk's "Print now"
opens), pictures it with headless Chrome at 300 dpi, trims (never scales) to the
QL's 696 printable dots, and sends all of a job's stickers in one print with a cut
after each. Then it reports (`/jobs/<id>/result`). A claim nobody reports back on
returns to the queue after two minutes.
