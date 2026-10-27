"""Independent X11/Tk input oracle; started only inside the test container."""
import ctypes as C
import json
import os
import signal
import sys
import tkinter as tk

path = sys.argv[1]
x = C.CDLL('libX11.so.6')
x.XOpenDisplay.restype = C.c_void_p
x.XDefaultRootWindow.argtypes = [C.c_void_p]
x.XDefaultRootWindow.restype = C.c_ulong
x.XKeysymToKeycode.argtypes = [C.c_void_p, C.c_ulong]
x.XKeysymToKeycode.restype = C.c_ubyte
x.XQueryKeymap.argtypes = [C.c_void_p, C.c_void_p]
x.XGetInputFocus.argtypes = [C.c_void_p, C.c_void_p, C.c_void_p]
x.XSetInputFocus.argtypes = [C.c_void_p, C.c_ulong, C.c_int, C.c_ulong]
x.XFlush.argtypes = [C.c_void_p]
x.XQueryPointer.argtypes = [C.c_void_p, C.c_ulong] + [C.c_void_p] * 7
d = x.XOpenDisplay(None)
assert d, 'X display unavailable'
root_window = x.XDefaultRootWindow(d)
shift_code = x.XKeysymToKeycode(d, 0xffe1)
root = tk.Tk()
root.overrideredirect(True)
root.geometry('1280x720+0+0')
root.configure(bg='#20b060')
root.attributes('-topmost', True)
entry = tk.Entry(root, font=('monospace', 24))
entry.place(x=100, y=100, width=600, height=60)
def focus_entry(_event=None):
    entry.focus_force()
    x.XSetInputFocus(d, entry.winfo_id(), 1, 0)
    x.XFlush(d)
entry.bind('<ButtonPress-1>', focus_entry)
events = []
for name in ('KeyPress', 'KeyRelease', 'ButtonPress', 'ButtonRelease', 'Motion'):
    root.bind_all('<' + name + '>', lambda e, n=name: events.append({
        'type': n, 'key': e.keysym, 'button': str(e.num), 'x': e.x_root, 'y': e.y_root}))
changed = False
def change(_signum, _frame):
    global changed
    changed = True
signal.signal(signal.SIGUSR1, change)
def publish():
    if changed:
        root.configure(bg='#c030b0')
    keymap = C.create_string_buffer(32)
    x.XQueryKeymap(d, keymap)
    rr, child = C.c_ulong(), C.c_ulong()
    rx, ry, wx, wy = C.c_int(), C.c_int(), C.c_int(), C.c_int()
    mask = C.c_uint()
    focus, revert = C.c_ulong(), C.c_int()
    x.XGetInputFocus(d, C.byref(focus), C.byref(revert))
    x.XQueryPointer(d, root_window, C.byref(rr), C.byref(child), C.byref(rx),
                    C.byref(ry), C.byref(wx), C.byref(wy), C.byref(mask))
    state = {'pid': os.getpid(), 'entry': entry.get(), 'events': events[-300:],
             'shift': bool(keymap.raw[shift_code // 8] & (1 << (shift_code % 8))),
             'button1': bool(mask.value & 256), 'pointer': [rx.value, ry.value],
             'changed': changed, 'xFocus': focus.value,
             'entryWindow': entry.winfo_id(), 'rootWindow': root.winfo_id(), 'tkFocus': str(root.focus_get())}
    with open(path + '.next', 'w') as f:
        json.dump(state, f)
    os.replace(path + '.next', path)
    root.after(40, publish)
root.lift()
# XSetInputFocus only takes effect after the override-redirect window is mapped.
root.after(100, focus_entry)
publish()
root.mainloop()
