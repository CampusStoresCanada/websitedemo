#!/usr/bin/env python3
"""
CSC Print Station — prints the check-in desk's queued stickers on a Brother QL.

Runs on the laptop beside the printer. Any desk device taps "Send to print
queue"; this picks the job up, pictures each sticker with the computer's own
Chrome (or Edge) at exactly the sticker's size, and sends it STRAIGHT to the
printer: each sticker at its own length, cut between stickers.

Why not the print dialog: the printer driver overrides the page size with its
own paper (a 120 mm back came out as two 100 mm pieces). Talking to the printer
directly — the way last year's badge printer did (brother_ql) — the length is
ours, and the stickers line up with the card to fractions of a millimetre.

It also prints DOCUMENTS sent from the War Room ("Send to printer" on a task's
speech or run-sheet): the website hands over a PDF, and this sends it to the
laptop's ordinary paper printer with the system's own `lp`.

Setup: run it once and paste the print station key (War Room → What's next →
Open the print station → Get a key).
"""

import json
import math
import os
import platform
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

import requests
from PIL import Image

# brother_ql uses Image.ANTIALIAS, removed in Pillow 10 (same patch as last year).
if not hasattr(Image, "ANTIALIAS"):
    Image.ANTIALIAS = Image.LANCZOS

from brother_ql.backends.helpers import send  # noqa: E402
from brother_ql.conversion import convert  # noqa: E402
from brother_ql.raster import BrotherQLRaster  # noqa: E402

# CSC_PRINT_STATION_CONFIG points it elsewhere (testing, or two stations on one machine).
CONFIG_PATH = Path(os.environ.get("CSC_PRINT_STATION_CONFIG") or Path.home() / ".csc-print-station.json")
DEFAULT_SERVER = "https://campusstores.ca"

# ⛔ Last year's proven setting: brother_ql does not list the QL-1110NWB, and
# the QL-1060N model id drives it correctly over USB.
PRINTER_MODEL = "QL-1060N"
BROTHER_USB_VENDOR = 0x04F9
LABEL = "62"           # 62 mm continuous roll (DK-2113 clear / DK-22205 paper)
PRINTABLE_DOTS = 696   # the QL prints 696 dots across 62 mm tape
DPI = 300
POLL_SECONDS = 3


def log(message: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}", flush=True)


# ── Setup ─────────────────────────────────────────────────────────────────────

def load_config() -> dict:
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text())
    return {}


def save_config(config: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(config, indent=2))
    try:
        os.chmod(CONFIG_PATH, 0o600)  # the key is a credential
    except OSError:
        pass


def setup(config: dict) -> dict:
    print("\nCSC Print Station — first-time setup\n")
    server = input(f"Website address [{config.get('server', DEFAULT_SERVER)}]: ").strip()
    config["server"] = (server or config.get("server") or DEFAULT_SERVER).rstrip("/")
    key = input("Print station key (starts with cscps_): ").strip()
    if not key.startswith("cscps_"):
        sys.exit("That is not a print station key. Make one in the War Room: What's next → Open the print station.")
    config["key"] = key
    printer = input("Sticker printer [blank = find it on USB, or tcp://PRINTER-IP:9100]: ").strip()
    if printer:
        config["printer"] = printer
    paper = list_paper_printers()
    if paper:
        print(f"Paper printers on this laptop: {', '.join(paper)}")
    document_printer = input(
        f"Paper printer for documents [{config.get('document_printer') or 'blank = the default printer'}]: "
    ).strip()
    if document_printer:
        config["document_printer"] = document_printer
    save_config(config)
    print(f"\nSaved to {CONFIG_PATH}\n")
    return config


# ── The printer ───────────────────────────────────────────────────────────────

def find_printer(config: dict) -> str:
    """The printer to send to: as configured, or the first Brother on USB."""
    if config.get("printer"):
        return config["printer"]
    import usb.core  # pyusb

    device = usb.core.find(idVendor=BROTHER_USB_VENDOR)
    if device is None:
        raise RuntimeError("No Brother printer found on USB. Plug the QL in, or set tcp://PRINTER-IP:9100.")
    return f"usb://0x{device.idVendor:04x}:0x{device.idProduct:04x}"


def backend_for(printer: str) -> str:
    return "network" if printer.startswith("tcp://") else "pyusb"


def print_images(printer: str, images: list) -> dict:
    """Send stickers in one job, cut after each. Returns brother_ql's status."""
    qlr = BrotherQLRaster(PRINTER_MODEL)
    instructions = convert(
        qlr=qlr, images=images, label=LABEL, rotate="0", threshold=70.0, dither=False,
        compress=False, red=False, dpi_600=False, hq=True, cut=True,
    )
    return send(instructions=instructions, printer_identifier=printer,
                backend_identifier=backend_for(printer), blocking=True)


def list_paper_printers() -> list:
    """The system's printers (CUPS), for setup. Empty where `lpstat` isn't available."""
    try:
        out = subprocess.run(["lpstat", "-a"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return [line.split()[0] for line in out.splitlines() if line.strip()]


def print_document(config: dict, pdf: bytes, title: str) -> None:
    """A PDF to the paper printer through the system's own `lp`. Raises on failure."""
    if platform.system() == "Windows":
        raise RuntimeError("Printing documents needs a Mac (or Linux) print station for now.")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "document.pdf"
        path.write_bytes(pdf)
        command = ["lp", "-t", title]
        if config.get("document_printer"):
            command += ["-d", config["document_printer"]]
        command.append(str(path))
        done = subprocess.run(command, capture_output=True, text=True, timeout=60)
        if done.returncode != 0:
            raise RuntimeError((done.stderr or done.stdout or "lp failed").strip())


def describe_printer(result: dict) -> tuple:
    state = result.get("printer_state") or {}
    media = state.get("media_type")
    width = state.get("media_width")
    media_text = f"{media} {width} mm" if media else None
    errors = state.get("errors") or []
    return ("; ".join(errors) if errors else "ready"), media_text


# ── Picturing a sticker ───────────────────────────────────────────────────────

def find_browser(config: dict) -> str:
    if config.get("browser") and Path(config["browser"]).exists():
        return config["browser"]
    system = platform.system()
    candidates = {
        "Darwin": [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ],
        "Windows": [
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        ],
    }.get(system, ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"])
    for path in candidates:
        if Path(path).exists():
            return path
    raise RuntimeError("Chrome or Edge is needed to draw the stickers, and neither was found.")


def picture_sticker(browser: str, html: str, width_mm: float, height_mm: float) -> Image.Image:
    """The sticker page as a 1:1 printer image: 300 dpi, trimmed to the printable width."""
    scale = DPI / 96  # CSS pixels → printer dots
    window_w = math.ceil(width_mm / 25.4 * 96)
    window_h = math.ceil(height_mm / 25.4 * 96) + 1
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "sticker.html"
        shot = Path(tmp) / "sticker.png"
        page.write_text(html, encoding="utf-8")
        subprocess.run(
            # ⛔ Its own throwaway profile, and no keychain: a headless Chrome
            # that reaches for the macOS keychain pops up a dialog on the
            # laptop and waits on it forever (2026-10-21).
            [browser, "--headless=new", "--disable-gpu", "--hide-scrollbars",
             f"--user-data-dir={Path(tmp) / 'profile'}", "--use-mock-keychain", "--password-store=basic",
             "--no-first-run", "--no-default-browser-check",
             "--default-background-color=FFFFFFFF", f"--force-device-scale-factor={scale}",
             f"--window-size={window_w},{window_h}", "--virtual-time-budget=8000",
             f"--screenshot={shot}", page.as_uri()],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60,
        )
        image = Image.open(shot).convert("RGB")
        image.load()
    # ⛔ TRIM, never scale: the QL prints 696 dots across the tape, and letting
    # the library shrink a full 62 mm picture to fit makes everything ~5%
    # smaller — and off the card. The trimmed edges are blank by design.
    target_h = round(height_mm / 25.4 * DPI)
    left = max(0, (image.width - PRINTABLE_DOTS) // 2)
    return image.crop((left, 0, left + PRINTABLE_DOTS, min(image.height, target_h)))


# ── The queue ─────────────────────────────────────────────────────────────────

class Station:
    def __init__(self, config: dict):
        self.server = config["server"]
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {config['key']}"
        self.printer_status = None
        self.printer_media = None

    def url(self, path: str) -> str:
        return f"{self.server}{path}"

    def heartbeat(self) -> dict:
        r = self.session.post(self.url("/api/print-station/heartbeat"),
                              json={"printerStatus": self.printer_status, "printerMedia": self.printer_media},
                              timeout=15)
        if r.status_code == 401:
            sys.exit("This print station key is unknown or was revoked. Make a new one in the War Room.")
        r.raise_for_status()
        return r.json()

    def claim(self):
        # Saying we print documents is what gets us handed them; an older
        # station that doesn't say so only ever gets stickers.
        r = self.session.post(self.url("/api/print-station/claim"),
                              json={"accepts": ["stickers", "document"]}, timeout=15)
        r.raise_for_status()
        return r.json().get("job")

    def document(self, job_id: str) -> bytes:
        r = self.session.get(self.url(f"/api/print-station/jobs/{job_id}/document"), timeout=120)
        if r.status_code == 422:
            raise DocumentError(r.json().get("error", "This document cannot be printed."))
        r.raise_for_status()
        return r.content

    def sticker(self, job_id: str, side: str):
        r = self.session.get(self.url(f"/api/print-station/jobs/{job_id}/sticker"), params={"side": side}, timeout=60)
        if r.status_code != 200:
            raise StickerError(r.json().get("error", f"The {side} sticker could not be drawn."))
        return r.text, float(r.headers["x-sticker-width-mm"]), float(r.headers["x-sticker-height-mm"])

    def report(self, job_id: str, ok: bool, retry: bool = False, error: str = None) -> None:
        self.session.post(self.url(f"/api/print-station/jobs/{job_id}/result"),
                          json={"ok": ok, "retry": retry, "error": error}, timeout=15)


class StickerError(Exception):
    """The sticker itself cannot be drawn — retrying will not help."""


class DocumentError(Exception):
    """The document itself cannot become a PDF (not shared, not a PDF) — retrying will not help."""


def run_document_job(station: "Station", config: dict, job: dict) -> None:
    title = job.get("title") or "Document"
    log(f"Printing document: {title}")
    try:
        pdf = station.document(job["jobId"])
    except DocumentError as error:
        log(f"  Cannot print this document: {error}")
        station.report(job["jobId"], ok=False, retry=False, error=str(error))
        return
    except requests.RequestException as error:
        log(f"  Could not fetch it ({error}). It stays in the queue.")
        station.report(job["jobId"], ok=False, retry=True, error=f"Fetching failed: {error}")
        return
    try:
        print_document(config, pdf, title)
    except Exception as error:  # printer missing, lp refused
        log(f"  The paper printer refused it: {error}. It stays in the queue.")
        station.report(job["jobId"], ok=False, retry=True, error=f"Paper printer: {error}")
        return
    log(f"  Sent to {config.get('document_printer') or 'the default printer'}.")
    station.report(job["jobId"], ok=True)


def run_job(station: Station, browser: str, printer: str, job: dict) -> None:
    name = job.get("personName") or "someone"
    log(f"Printing {name}: {', '.join(job['stickers'])}")
    try:
        images = []
        for side in job["stickers"]:
            html, width_mm, height_mm = station.sticker(job["jobId"], side)
            images.append(picture_sticker(browser, html, width_mm, height_mm))
            log(f"  {side}: {width_mm:.0f} × {height_mm:.0f} mm")
    except StickerError as error:
        log(f"  Cannot draw this sticker: {error}")
        station.report(job["jobId"], ok=False, retry=False, error=str(error))
        return
    except (subprocess.SubprocessError, OSError) as error:
        # The browser failed to draw it this time (hung, crashed). Not the
        # sticker's fault: back to the queue.
        log(f"  The browser could not draw the sticker ({error}). It stays in the queue.")
        station.report(job["jobId"], ok=False, retry=True, error=f"Drawing failed: {error}")
        return

    try:
        result = print_images(printer, images)
    except Exception as error:  # cable out, printer off
        station.printer_status = f"Not reachable: {error}"
        log(f"  Printer not reachable: {error}. It stays in the queue.")
        station.report(job["jobId"], ok=False, retry=True, error=f"Printer not reachable: {error}")
        return

    station.printer_status, station.printer_media = describe_printer(result)
    if result.get("did_print"):
        log(f"  Printed. ({station.printer_media})")
        station.report(job["jobId"], ok=True)
    else:
        # ⛔ A printer problem (wrong roll, out of film, lid open) is not the
        # sticker's fault: back to the queue, printed once it is fixed.
        log(f"  The printer refused it: {station.printer_status}. Loaded: {station.printer_media}. It stays in the queue.")
        station.report(job["jobId"], ok=False, retry=True, error=station.printer_status)


def main() -> None:
    config = load_config()
    if "--setup" in sys.argv or not config.get("key"):
        config = setup(config)
    browser = find_browser(config)
    printer = find_printer(config)
    station = Station(config)
    hello = station.heartbeat()
    log(f"CSC Print Station \"{hello['station']}\" for {hello['conference']}")
    log(f"Printer: {printer} · Drawing with: {Path(browser).name} · Ctrl+C to stop")

    while True:
        try:
            station.heartbeat()
            job = station.claim()
            if job:
                if job.get("kind") == "document":
                    run_document_job(station, config, job)
                else:
                    run_job(station, browser, printer, job)
                continue  # straight on to the next one
        except requests.RequestException as error:
            log(f"Website not reachable ({error}); trying again.")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Stopped.")
