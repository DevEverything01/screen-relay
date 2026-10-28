"""The doctor command."""
import ctypes
import ctypes.util
import os
from pathlib import Path
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import zlib

from .common import DEFAULT_PORT, Failure, emit
from .state import state_dir
from .supervisor import clear_ambient_caps, find_engine, start_xvfb, x_query


def tiny_png():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b'\0\0\0\0\0')) + chunk(b'IEND', b''))


TINY_SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'


def icon_probe(library, suffix, data):
    """Decode an image through gdk-pixbuf in a child with ambient caps cleared, as desktop children run."""
    with tempfile.NamedTemporaryFile(suffix=suffix) as image:
        image.write(data)
        image.flush()
        read_fd, write_fd = os.pipe()
        pid = os.fork()
        if pid == 0:
            os.close(read_fd)
            signal.alarm(20)
            message = b''
            try:
                clear_ambient_caps()
                pixbuf = ctypes.CDLL(library)
                pixbuf.gdk_pixbuf_new_from_file.restype = ctypes.c_void_p
                pixbuf.gdk_pixbuf_new_from_file.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
                error = ctypes.c_void_p()
                if not pixbuf.gdk_pixbuf_new_from_file(image.name.encode(), ctypes.byref(error)):
                    text = ctypes.cast(error.value + 8, ctypes.POINTER(ctypes.c_char_p)).contents.value if error.value else None
                    message = text or b'decode failed'
            except BaseException as failure:
                message = str(failure).encode() or b'probe failed'
            os.write(write_fd, message)
            os._exit(1 if message else 0)
        os.close(write_fd)
        with os.fdopen(read_fd, 'rb') as stream:
            message = stream.read().decode(errors='replace')
        status = os.waitpid(pid, 0)[1]
    return status == 0, message or ('' if status == 0 else 'probe crashed or timed out')


def cmd_doctor(args):
    checks = []

    def check(name, ok, detail, fix='', level='fail'):
        checks.append({'name': name, 'status': 'ok' if ok else level, 'detail': detail, 'fix': '' if ok else fix})
        return ok

    linux = check('platform', sys.platform.startswith('linux'), sys.platform,
                  'Run doctor on the Linux host; this machine can use client commands with --url.')
    if linux:
        root = os.geteuid() == 0
        sudo = '' if root else 'sudo '
        apt = f'{sudo}apt-get install -y --no-install-recommends '
        check('user', True, 'root' if root else f'uid {os.geteuid()} (not root)')
        check('python3', sys.version_info >= (3, 8), sys.version.split()[0], apt + 'python3')
        check('home', os.access(Path.home(), os.W_OK), str(Path.home()), 'export HOME=/path/to/a/writable/dir')
        state = state_dir('default').parent
        try:
            state.mkdir(parents=True, exist_ok=True)
            writable = os.access(state, os.W_OK)
        except OSError:
            writable = False
        check('state dir', writable, str(state), 'export XDG_STATE_HOME=/path/to/a/writable/dir')
        engine = find_engine()
        runs = bool(engine) and subprocess.run([str(engine), '--help'], capture_output=True).returncode == 0
        check('engine', runs, str(engine or 'relay-engine not found'), './install.sh')
        x264 = ctypes.util.find_library('x264')
        check('libx264', bool(x264), x264 or 'not found',
              apt + "$(apt-cache search --names-only '^libx264-[0-9]+$' | cut -d' ' -f1)")
        for program, package in (('Xvfb', 'xvfb'), ('xauth', 'xauth'), ('xprop', 'x11-utils'),
                                 ('xwininfo', 'x11-utils'), ('xdpyinfo', 'x11-utils')):
            check(program, bool(shutil.which(program)), shutil.which(program) or 'not found', apt + package)
        check('dbus-run-session', bool(shutil.which('dbus-run-session')), shutil.which('dbus-run-session') or 'not found',
              apt + 'dbus', 'warn')
        check('xfce4-session', bool(shutil.which('xfce4-session')), shutil.which('xfce4-session') or 'not found (use --desktop none)',
              './install.sh (or ' + apt + 'xfce4-session xfwm4 xfce4-panel xfdesktop4)', 'warn')
        sockets = Path('/tmp/.X11-unix')
        try:
            info = sockets.stat()
            ok = sockets.is_dir() and ((info.st_mode & 0o1777) == 0o1777 or info.st_uid == os.geteuid())
        except FileNotFoundError:
            ok = os.access('/tmp', os.W_OK)
        check('/tmp/.X11-unix', ok, 'usable' if ok else 'not writable for Xvfb',
              f'{sudo}mkdir -p /tmp/.X11-unix && {sudo}chmod 1777 /tmp/.X11-unix')
        with socket.socket() as probe:
            try:
                probe.bind(('127.0.0.1', DEFAULT_PORT))
                free = True
            except OSError:
                free = False
        check('port', free, f'127.0.0.1:{DEFAULT_PORT} ' + ('free' if free else 'in use'),
              f'relay up --port {DEFAULT_PORT + 1}', 'warn')
        if shutil.which('Xvfb') and shutil.which('xauth') and shutil.which('xdpyinfo'):
            with tempfile.TemporaryDirectory() as scratch:
                auth, children = Path(scratch) / 'auth', []
                auth.write_bytes(b'')

                def spawn(command, **options):
                    children.append(subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                                     start_new_session=True, **options))
                    return children[-1]
                try:
                    display = start_xvfb(spawn, auth)
                    output = x_query(dict(os.environ, DISPLAY=display, XAUTHORITY=str(auth)), 'xdpyinfo')
                    missing = [e for e in ('XTEST', 'DAMAGE', 'XFIXES', 'MIT-SHM') if e not in output]
                    check('X extensions', not missing, 'missing ' + ', '.join(missing) if missing else 'XTEST DAMAGE XFIXES MIT-SHM',
                          'Use the distribution Xvfb; MIT-SHM also needs SysV shared memory (shared IPC namespace).')
                except Failure as failure:
                    check('X extensions', False, failure.message, failure.hint)
                finally:
                    for child in children:
                        child.terminate()
                        child.wait()
        caps = next((l.split()[1] for l in Path('/proc/self/status').read_text().splitlines() if l.startswith('CapAmb:')), '0')
        check('ambient caps', int(caps, 16) == 0, 'none' if int(caps, 16) == 0 else f'{caps}: apps that inherit them crash on icons',
              'Start apps with `relay run -- APP`, which clears them; the desktop and its menus already do.', 'warn')
        library = ctypes.util.find_library('gdk_pixbuf-2.0')
        if library:
            ok, message = icon_probe(library, '.png', tiny_png())
            kind = 'PNG'
            if ok:
                ok, message = icon_probe(library, '.svg', TINY_SVG)
                kind = 'SVG'
            fix = 'See the detail; read `relay logs desktop` after a failed start.'
            if not ok and subprocess.run(['apt-cache', 'show', 'glycin-loaders'], capture_output=True).returncode == 0 \
                    and subprocess.run(['dpkg', '-s', 'glycin-loaders'], capture_output=True).returncode != 0:
                fix = apt + 'glycin-loaders'
            elif not ok and shutil.which('bwrap'):
                sandbox = subprocess.run(['bwrap', '--ro-bind', '/', '/', '--unshare-user', 'true'], capture_output=True,
                                         text=True, preexec_fn=clear_ambient_caps)
                if sandbox.returncode:
                    message += f'; bubblewrap failed: {sandbox.stderr.strip()}'
                    fix = ('Image loaders sandbox with bubblewrap, which needs unprivileged user namespaces: allow them for '
                           'bwrap (AppArmor profile or kernel.unprivileged_userns_clone=1). relay never disables sandboxing.')
            check('icon decoding', ok, 'gdk-pixbuf decodes PNG and SVG' if ok else f'{kind}: {message}', fix,
                  'warn' if kind == 'SVG' else 'fail')
        else:
            check('icon decoding', False, 'gdk-pixbuf not installed (desktop not installed)', './install.sh', 'warn')
    failed = any(c['status'] == 'fail' for c in checks)
    lines = []
    for c in checks:
        lines.append(f'{c["status"]:5} {c["name"]:17} {c["detail"]}')
        if c['fix']:
            lines.append(f'{"":23}fix: {c["fix"]}')
    emit(args, {'ok': not failed, 'checks': checks}, '\n'.join(lines))
    return 1 if failed else 0
