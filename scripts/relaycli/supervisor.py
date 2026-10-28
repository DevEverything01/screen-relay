"""Session supervisor: display, desktop and engine processes."""
import ctypes
import json
import os
import re
import secrets
import select
import shlex
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

from .client import connect_host, http
from .common import LAUNCHER_DIR, Failure
from .state import identity, sweep, tail, write_session

HINTS = {
    'display': 'Check Xvfb and /tmp/.X11-unix with `relay doctor`.',
    'dbus': 'Read `relay logs dbus` and check dbus-daemon is installed.',
    'desktop': 'Run `relay doctor` (icon decoding, D-Bus) and read `relay logs desktop`.',
    'engine': 'If the port is taken, pick another with --port; otherwise run `relay doctor`.',
}


def clear_ambient_caps():
    """Drop inherited ambient capabilities; bubblewrap (glycin image loaders) refuses to run with them."""
    if sys.platform.startswith('linux'):
        ctypes.CDLL(None).prctl(47, 4, 0, 0, 0)


def desktop_env(directory):
    """Environment shared by the desktop and apps started in a session; carries the marker `down` sweeps."""
    env = dict(os.environ, XDG_RUNTIME_DIR=str(directory / 'runtime'), XDG_CONFIG_HOME=str(directory / 'config'),
               XDG_CACHE_HOME=str(directory / 'cache'), ICEAUTHORITY=str(directory / 'ICEauthority'),
               RELAY_SESSION=str(directory))
    env.pop('DBUS_SESSION_BUS_ADDRESS', None)
    return env


def find_engine():
    for candidate in (LAUNCHER_DIR / 'relay-engine', LAUNCHER_DIR.parent / 'relay-engine'):
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    found = shutil.which('relay-engine')
    return Path(found) if found else None


def start_xvfb(spawn, auth):
    """Start Xvfb on a free display (via -displayfd) with a private cookie; returns ':N'."""
    cookie = secrets.token_hex(16)

    def authorize(display):
        subprocess.run(['xauth', '-f', str(auth), 'add', display, '.', cookie], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    authorize(':0')
    read_fd, write_fd = os.pipe()
    try:
        process = spawn(['Xvfb', '-displayfd', str(write_fd), '-screen', '0', '1280x720x24', '-nolisten', 'tcp',
                         '-noreset', '-s', '0', '-auth', str(auth)], pass_fds=(write_fd,))
        os.close(write_fd)
        write_fd = None
        text, deadline = b'', time.monotonic() + 15
        while b'\n' not in text:
            if process.poll() is not None:
                raise Failure('component_failed', f'display exited with code {process.returncode}', HINTS['display'], component='display')
            if time.monotonic() > deadline or len(text) > 64:
                raise Failure('timeout', 'Xvfb did not report a display', HINTS['display'], component='display')
            if select.select([read_fd], [], [], 0.2)[0]:
                chunk = os.read(read_fd, 64)
                text += chunk or b'?\n'
    finally:
        os.close(read_fd)
        if write_fd is not None:
            os.close(write_fd)
    if not text.strip().isdigit():
        raise Failure('component_failed', 'Xvfb did not allocate a display', HINTS['display'], component='display')
    display = ':' + text.decode().strip()
    authorize(display)
    return display


def x_query(env, *command):
    try:
        return subprocess.run(command, env=env, capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ''


class Session:
    """One supervised run of display, desktop and engine, owned by this process."""

    def __init__(self, args, directory):
        self.args, self.dir = args, directory
        self.children, self.logs = {}, []
        self.data = {'name': args.name, 'state': 'starting', 'supervisor': identity(os.getpid()),
                     'logs': str(directory), 'port': args.port, 'components': {}}

    def save(self, **changes):
        self.data.update(changes)
        write_session(self.dir, self.data)

    def spawn(self, name, command, **options):
        log = open(self.dir / f'{name}.log', 'wb')
        self.logs.append(log)
        try:
            process = subprocess.Popen(command, env=self.env, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                       start_new_session=True, preexec_fn=clear_ambient_caps, **options)
        except OSError as error:
            raise Failure('component_failed', f'Cannot start {name}: {error}', HINTS[name], component=name) from None
        self.children[name] = process
        self.data['components'][name] = identity(process.pid)
        self.save()
        return process

    def failure(self, name, code, message):
        return Failure(code, message, HINTS[name], component=name, log=tail(self.dir / f'{name}.log'), logs=str(self.dir))

    def check_children(self):
        for name, process in self.children.items():
            if process.poll() is not None:
                raise self.failure(name, 'component_failed', f'{name} exited with code {process.returncode}')

    def start_bus(self):
        """Start a supervised session bus and share its address with desktop apps."""
        read_fd, write_fd = os.pipe()
        try:
            self.spawn('dbus', ['dbus-daemon', '--session', '--nofork', f'--print-address={write_fd}'],
                       pass_fds=(write_fd,))
            os.close(write_fd)
            write_fd = None
            address, deadline = b'', time.monotonic() + 5
            while b'\n' not in address:
                self.check_children()
                if time.monotonic() > deadline or len(address) > 4096:
                    raise self.failure('dbus', 'timeout', 'Session bus did not report its address')
                if select.select([read_fd], [], [], 0.2)[0]:
                    chunk = os.read(read_fd, 4096)
                    if not chunk:
                        raise self.failure('dbus', 'component_failed', 'Session bus closed its address pipe')
                    address += chunk
            self.env['DBUS_SESSION_BUS_ADDRESS'] = address.decode().strip()
        finally:
            os.close(read_fd)
            if write_fd is not None:
                os.close(write_fd)

    def start(self):
        args, directory = self.args, self.dir
        runtime = directory / 'runtime'
        shutil.rmtree(runtime, ignore_errors=True)
        runtime.mkdir(mode=0o700)
        self.env = dict(os.environ, RELAY_SESSION=str(directory)) if args.display else desktop_env(directory)
        engine = find_engine()
        if not engine:
            raise Failure('missing_dependency', 'relay-engine not found', 'Run ./install.sh first.', component='engine')
        desktop = args.desktop or ('none' if args.display else 'xfce')
        command = ['xfce4-session'] if desktop == 'xfce' else [] if desktop == 'none' else shlex.split(desktop)
        needed = ([] if args.display else ['Xvfb', 'xauth']) + (['xprop', 'xwininfo', command[0]] if command else [])
        missing = [p for p in needed if not shutil.which(p)]
        own_bus = bool(command and not args.display and shutil.which('dbus-daemon'))
        if command and not args.display and not own_bus and shutil.which('dbus-run-session'):
            command = ['dbus-run-session', '--', *command]
        elif desktop == 'xfce' and not args.display and not own_bus:
            missing.append('dbus-run-session')
        if missing:
            raise Failure('missing_dependency', 'Missing ' + ', '.join(missing), 'Run ./install.sh, or check with `relay doctor`.')
        if args.display:
            self.env['DISPLAY'] = args.display
        else:
            auth = directory / 'Xauthority'
            auth.write_bytes(b'')
            auth.chmod(0o600)
            self.env['XAUTHORITY'] = str(auth)
            try:
                self.env['DISPLAY'] = start_xvfb(lambda cmd, **kw: self.spawn('display', cmd, **kw), auth)
            except Failure as failure:
                raise self.failure('display', failure.code, failure.message) from None
        if own_bus:
            self.start_bus()
        environment = {key: self.env[key] for key in ('DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME',
                                                      'XDG_CACHE_HOME', 'ICEAUTHORITY') if key in self.env}
        self.save(display=self.env['DISPLAY'], xauthority=self.env.get('XAUTHORITY'), ownsDisplay=not args.display,
                  desktop=desktop, environment=environment)
        if command:
            self.spawn('desktop', command)
        bind = args.bind or ('0.0.0.0' if args.public else '127.0.0.1')
        token = None
        engine_command = [str(engine), '--bind', bind, '--port', str(args.port)]
        if bind != '127.0.0.1' or args.public:
            token = secrets.token_hex(32)
            token_file = directory / 'token'
            descriptor = os.open(token_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, 'w') as stream:
                stream.write(token + '\n')
            engine_command += ['--token-file', str(token_file)]
            self.data['tokenFile'] = str(token_file)
        if args.public:
            engine_command += ['--public-origin', args.public]
        if args.tls_cert:
            engine_command += ['--tls-cert', args.tls_cert, '--tls-key', args.tls_key]
        elif args.public:
            engine_command.append('--behind-tls-proxy')
        scheme = 'https' if args.tls_cert else 'http'
        local_url = f'{scheme}://127.0.0.1:{args.port}'
        self.save(bind=bind, localUrl=local_url, url=args.public or local_url,
                  tlsCert=os.path.abspath(args.tls_cert) if args.tls_cert else None)
        engine_process = self.spawn('engine', engine_command)
        self.wait_ready(engine_process.pid, (local_url, token, self.data['tlsCert'], connect_host(bind)), desktop)
        self.save(state='ready', ready=time.time())
        url = self.data['url']
        return {'ready': True, 'name': args.name, 'url': url, 'viewer': f'{url}/#token={token}' if token else url,
                'token': token, 'display': self.env['DISPLAY'], 'xauthority': self.env.get('XAUTHORITY'),
                'logs': str(directory), 'pid': os.getpid(), 'enginePid': engine_process.pid, 'bind': bind,
                'port': args.port, 'public': bool(args.public)}

    def engine_ready(self, pid, where):
        own = False
        for line in tail(self.dir / 'engine.log', 50).splitlines():
            if line.startswith('{'):
                try:
                    message = json.loads(line)
                except ValueError:
                    continue
                own |= message.get('ready') is True and message.get('pid') == pid
        if not own:
            return False
        try:
            return http(where, '/screenshot.png', 3, binary=True)[:8] == b'\x89PNG\r\n\x1a\n'
        except Failure:
            return False

    def desktop_ready(self, desktop):
        if desktop == 'xfce':
            found = x_query(self.env, 'xprop', '-root', '_NET_SUPPORTING_WM_CHECK', '_NET_CLIENT_LIST')
            return len(re.findall(r'window id # 0x', found)) >= 2
        match = re.search(r'(\d+) child', x_query(self.env, 'xwininfo', '-root', '-children'))
        return bool(match and int(match.group(1)))

    def wait_ready(self, pid, where, desktop):
        deadline = time.monotonic() + self.args.timeout
        pending = ['engine'] + (['desktop'] if desktop != 'none' else [])
        while pending:
            self.check_children()
            if pending[0] == 'engine' and self.engine_ready(pid, where) or pending[0] == 'desktop' and self.desktop_ready(desktop):
                pending.pop(0)
                continue
            if time.monotonic() > deadline:
                raise self.failure(pending[0], 'timeout', f'{pending[0]} not ready after {self.args.timeout:g}s')
            time.sleep(0.2)

    def supervise(self):
        while True:
            self.check_children()
            time.sleep(0.2)

    def cleanup(self):
        engine = self.children.get('engine')
        if engine and engine.poll() is None:
            engine.terminate()
            try:
                engine.wait(timeout=3)
            except subprocess.TimeoutExpired:
                pass
        processes = list(self.children.values())[::-1]
        for process in processes:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                pass
        for process in processes:
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
                process.wait()
        sweep(self.dir)
        for log in self.logs:
            log.close()
