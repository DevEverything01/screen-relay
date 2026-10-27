"""Read the real X11 cursor independently of the streaming server (no UI mutation)."""
import ctypes as c
import json


class Image(c.Structure):
    _fields_ = [('x', c.c_short), ('y', c.c_short), ('width', c.c_ushort),
                ('height', c.c_ushort), ('xhot', c.c_ushort), ('yhot', c.c_ushort),
                ('serial', c.c_ulong), ('pixels', c.POINTER(c.c_ulong)),
                ('atom', c.c_ulong), ('name', c.c_char_p)]


x = c.CDLL('libX11.so.6')
fixes = c.CDLL('libXfixes.so.3')
x.XOpenDisplay.argtypes = [c.c_char_p]
x.XOpenDisplay.restype = c.c_void_p
x.XCloseDisplay.argtypes = [c.c_void_p]
x.XFree.argtypes = [c.c_void_p]
fixes.XFixesQueryVersion.argtypes = [c.c_void_p, c.POINTER(c.c_int), c.POINTER(c.c_int)]
fixes.XFixesGetCursorImage.argtypes = [c.c_void_p]
fixes.XFixesGetCursorImage.restype = c.POINTER(Image)
display = x.XOpenDisplay(None)
assert display, 'No X11 display'
image = None
try:
    major, minor = c.c_int(2), c.c_int(0)
    assert fixes.XFixesQueryVersion(display, c.byref(major), c.byref(minor)) and major.value >= 2
    image = fixes.XFixesGetCursorImage(display)
    assert image, 'No native cursor image'
    i = image.contents
    assert 0 < i.width <= 256 and 0 < i.height <= 256
    print(json.dumps(dict(x=i.x, y=i.y, width=i.width, height=i.height,
                          xhot=i.xhot, yhot=i.yhot, serial=i.serial,
                          name=i.name.decode() if i.name else None,
                          argb=[i.pixels[n] & 0xffffffff for n in range(i.width * i.height)])))
finally:
    if image:
        x.XFree(image)
    x.XCloseDisplay(display)
