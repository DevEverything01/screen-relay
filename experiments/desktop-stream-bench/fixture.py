"""A native desktop fixture. Its pixels pass through the real display/stream."""
import json
from pathlib import Path
import time
import tkinter as tk

root = tk.Tk()
root.title("Desktop streaming lab — F1 idle · F2 scroll · F3 motion · F8 flash")
root.geometry("1120x600+70+45")
root.resizable(False, False)
canvas = tk.Canvas(root, width=1120, height=600, bg="#f7f7fa", highlightthickness=0)
canvas.pack()
mode = "idle"
frame = 0
flash = False
toggle_count = 0
last_command = ""
measure_frames = False
command_path = Path("/tmp/bench-mode")
status_path = Path("/tmp/bench-status.json")
line = "The quick brown fox 0123456789  Il1 O0  {} [] ()  != <=  @example.org"

def publish():
    temporary = status_path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"mode": mode, "flash": flash, "toggles": toggle_count, "frame": frame,
        "time_ns": time.monotonic_ns(), "x": canvas.winfo_rootx(), "y": canvas.winfo_rooty(),
        "fps_marker": measure_frames}))
    temporary.replace(status_path)

def choose(value, fps=False):
    global mode, measure_frames
    mode = value
    measure_frames = fps
    paint()

def toggle(event=None):
    global flash, toggle_count
    flash = not flash
    toggle_count += 1
    canvas.itemconfigure("flash", fill="#00dd33" if flash else "#dd0033")
    publish()

def paint():
    canvas.delete("all")
    canvas.create_text(24, 24, anchor="nw", text="FULL DESKTOP / STREAM TEST", font=("DejaVu Sans", 18, "bold"), fill="#171b25")
    canvas.create_text(24, 60, anchor="nw", text="F1 Idle     F2 Scrolling text     F3 Motion     F8 Input latency", font=("DejaVu Sans", 11), fill="#424b60")
    for i, size in enumerate((9, 10, 11, 12, 14, 16)):
        y = 105 + i * 32
        canvas.create_text(24, y, anchor="nw", text=f"{size:2} pt  {line}", font=("DejaVu Sans Mono", size), fill="#101820")
    canvas.create_text(24, 310, anchor="nw", text="Color text: red #e02030 / blue #2050e0 / green #208030", font=("DejaVu Sans Mono", 13), fill="#2050e0")
    canvas.create_text(24, 345, anchor="nw", text="Type here:", font=("DejaVu Sans", 12), fill="#171b25")
    canvas.create_window(125, 342, anchor="nw", window=entry, width=850, height=30)
    canvas.create_rectangle(24, 390, 1096, 530, fill="#ffffff", outline="#d7dbe4", tags="motion-area")
    canvas.create_text(40, 410, anchor="nw", text="Idle: unchanged desktop. Open the desktop launcher to try real apps.", font=("DejaVu Sans", 13), fill="#171b25", tags="dynamic")
    canvas.create_rectangle(1000, 540, 1100, 590, fill="#00dd33" if flash else "#dd0033", outline="", tags="flash")
    canvas.create_text(24, 555, anchor="nw", text="Click the colored square to measure input → visible update", font=("DejaVu Sans", 12), fill="#424b60")
    canvas.tag_bind("flash", "<Button-1>", toggle)
    if measure_frames:
        for bit in range(14):
            canvas.create_rectangle(24 + bit * 8, 540, 32 + bit * 8, 552,
                fill="#ffffff", outline="", tags=f"frame-bit-{bit}")

def tick():
    global frame, last_command
    frame += 1
    if frame % 6 == 0 and command_path.exists():
        command = command_path.read_text().strip()
        if command != last_command:
            last_command = command
            choose(command.split()[0], "fps" in command.split())
    if mode in ("scroll", "motion"):
        canvas.delete("dynamic")
        if mode == "scroll":
            offset = frame % 24
            for row in range(5):
                y = 394 + row * 25 - offset
                if y >= 392:
                    canvas.create_text(40, y, anchor="nw", text=f"{frame // 24 + row:05}  {line}", font=("DejaVu Sans Mono", 12), fill="#171b25", tags="dynamic")
        else:
            for i in range(32):
                x = 25 + (frame * 9 + i * 37) % 1020
                y = 395 + (i % 4) * 30
                canvas.create_rectangle(x, y, x + 45, y + 25, fill=("#2463eb", "#df2b52", "#22a070", "#e1aa24")[i % 4], outline="", tags="dynamic")
    if measure_frames:
        for bit, value in enumerate([0, 1] + [(frame >> i) & 1 for i in range(12)]):
            canvas.itemconfigure(f"frame-bit-{bit}", fill="#ffffff" if value else "#000000")
    if frame % 30 == 0:
        publish()
    root.after(16, tick)

entry = tk.Entry(root, font=("DejaVu Sans Mono", 12))
root.bind("<F1>", lambda e: choose("idle"))
root.bind("<F2>", lambda e: choose("scroll"))
root.bind("<F3>", lambda e: choose("motion"))
root.bind("<F8>", toggle)
paint()
root.after(200, lambda: root.focus_force())
tick()
root.mainloop()
