#!/usr/bin/env python3
"""
CSC Print Station, as an app: a small window instead of a terminal.

The same engine as `csc_print_station.py` (which still runs from a terminal);
this only adds the window. First run asks for the website and the key (paste
it from the desk's print station page), then shows what the station is doing.
Packaged with PyInstaller (see build_app.sh), so the conference laptop needs
nothing installed except Chrome or Edge.
"""

import queue
import threading
import tkinter as tk
from tkinter import ttk

import csc_print_station as engine

PAD = 10


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.lines: "queue.Queue[str]" = queue.Queue()
        self.stop = threading.Event()
        self.worker = None
        root.title("CSC Print Station")
        root.geometry("620x420")
        root.minsize(480, 320)
        root.protocol("WM_DELETE_WINDOW", self.quit)
        engine.set_log_sink(self.lines.put)
        self.frame = None
        config = engine.load_config()
        if config.get("key"):
            self.show_status(config)
        else:
            self.show_setup(config)
        self.root.after(200, self.drain)

    # ── Setup ────────────────────────────────────────────────────────────────

    def show_setup(self, config: dict, error: str = "") -> None:
        self.stop_worker()
        self.swap_frame()
        f = self.frame
        ttk.Label(f, text="Set up this print station", font=("", 16, "bold")).grid(row=0, column=0, columnspan=2, sticky="w")
        ttk.Label(
            f,
            text="On the desk: Open the print station → Get a key, then Copy and paste it here.",
            wraplength=560,
        ).grid(row=1, column=0, columnspan=2, sticky="w", pady=(4, PAD))

        self.server = tk.StringVar(value=config.get("server", engine.DEFAULT_SERVER))
        self.key = tk.StringVar(value=config.get("key", ""))
        self.printer = tk.StringVar(value=config.get("printer", ""))
        for row, (label, var, hint) in enumerate(
            [
                ("Website", self.server, ""),
                ("Print station key", self.key, "starts with cscps_"),
                ("Printer", self.printer, "leave blank for USB, or tcp://PRINTER-IP:9100"),
            ],
            start=2,
        ):
            ttk.Label(f, text=label).grid(row=row * 2, column=0, sticky="w")
            entry = ttk.Entry(f, textvariable=var, width=60)
            entry.grid(row=row * 2, column=1, sticky="ew", pady=(2, 0))
            if hint:
                ttk.Label(f, text=hint, foreground="#666").grid(row=row * 2 + 1, column=1, sticky="w")
        f.columnconfigure(1, weight=1)
        if error:
            ttk.Label(f, text=error, foreground="#b00020", wraplength=560).grid(row=10, column=0, columnspan=2, sticky="w", pady=(PAD, 0))
        buttons = ttk.Frame(f)
        buttons.grid(row=11, column=1, sticky="e", pady=(PAD, 0))
        saved = engine.load_config()
        if saved.get("key"):
            # Back to printing with the settings already saved.
            ttk.Button(buttons, text="Cancel", command=lambda: self.show_status(saved)).pack(side="left", padx=(0, PAD))
        ttk.Button(buttons, text="Save and start", command=self.save).pack(side="left")

    def save(self) -> None:
        key = self.key.get().strip()
        if not key.startswith("cscps_"):
            self.show_setup(self.current_entries(), "That isn't a print station key. It starts with cscps_.")
            return
        config = engine.load_config()
        config["server"] = (self.server.get().strip() or engine.DEFAULT_SERVER).rstrip("/")
        config["key"] = key
        printer = self.printer.get().strip()
        if printer:
            config["printer"] = printer
        else:
            config.pop("printer", None)
        engine.save_config(config)
        self.show_status(config)

    def current_entries(self) -> dict:
        return {"server": self.server.get(), "key": self.key.get(), "printer": self.printer.get()}

    # ── Running ──────────────────────────────────────────────────────────────

    def show_status(self, config: dict) -> None:
        self.swap_frame()
        f = self.frame
        top = ttk.Frame(f)
        top.pack(fill="x")
        ttk.Label(top, text="Printing the desk's stickers", font=("", 16, "bold")).pack(side="left")
        ttk.Button(top, text="Change settings", command=lambda: self.show_setup(engine.load_config())).pack(side="right")
        ttk.Label(f, text="Leave this open, the printer plugged in and the laptop awake.").pack(anchor="w", pady=(4, PAD))
        self.log = tk.Text(f, height=16, wrap="word", state="disabled", font=("Menlo", 11))
        self.log.pack(fill="both", expand=True)
        self.start_worker(config)

    def start_worker(self, config: dict) -> None:
        self.stop_worker()
        self.stop = threading.Event()

        def work(stop: threading.Event) -> None:
            while not stop.is_set():
                try:
                    engine.run(config, stop)
                except engine.KeyRejected as error:
                    self.lines.put(f"!SETUP {error}")
                    return
                except Exception as error:  # no printer, no Chrome, website down at start
                    engine.log(f"{error} Trying again in 10 seconds.")
                    stop.wait(10)

        self.worker = threading.Thread(target=work, args=(self.stop,), daemon=True)
        self.worker.start()

    def stop_worker(self) -> None:
        self.stop.set()

    def drain(self) -> None:
        try:
            while True:
                line = self.lines.get_nowait()
                if line.startswith("!SETUP "):
                    self.show_setup(engine.load_config(), line[len("!SETUP "):])
                    continue
                if getattr(self, "log", None) is not None and self.log.winfo_exists():
                    self.log.configure(state="normal")
                    self.log.insert("end", line + "\n")
                    # Keep the last few hundred lines: it runs for days.
                    if int(self.log.index("end-1c").split(".")[0]) > 500:
                        self.log.delete("1.0", "100.0")
                    self.log.see("end")
                    self.log.configure(state="disabled")
        except queue.Empty:
            pass
        self.root.after(200, self.drain)

    def swap_frame(self) -> None:
        if self.frame is not None:
            self.frame.destroy()
        self.log = None
        self.frame = ttk.Frame(self.root, padding=PAD * 2)
        self.frame.pack(fill="both", expand=True)

    def quit(self) -> None:
        self.stop_worker()
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
