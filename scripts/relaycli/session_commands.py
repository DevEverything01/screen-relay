"""up, down, status, logs and run commands."""
import json
import os
from pathlib import Path
import re
import select
import shutil
import signal
import subprocess
import sys
import time

from .client import http, target
from .common import LAUNCHER_DIR, Failure, emit
from .state import alive, lock, read_session, reap, state_dir, tail, write_session
from .supervisor import Session, clear_ambient_caps, desktop_env
from .watcher import start_watcher

COMPONENTS = ('display', 'dbus', 'desktop', 'engine', 'apps')


def ready_text(info, args):
    lines = [f'relay "{info["name"]}" is ready', f'  url:     {info["url"]}', f'  viewer:  {info["viewer"]}']
    if info.get('token'):
        lines.append(f'  token:   {info["token"]}  (shown once; status --show-token prints it again)')
    lines += [f'  display: {info["display"]}', f'  logs:    {info["logs"]}']
    if info.get('public'):
        if not args.tls_cert:
            lines.append(f'Expects a TLS proxy in front: forward {info["url"]} to http://<this host>:{info["port"]}.')
    elif info.get('bind') != '127.0.0.1':
        lines.append(f'Listening on {info["bind"]}:{info["port"]}; reach it through a loopback port publish or SSH tunnel.')
    return '\n'.join(lines)


def require_linux():
    if not sys.platform.startswith('linux'):
        raise Failure('unsupported_platform', 'Host commands run on Linux only',
                      'Run this on the Linux machine; client commands (status, screenshot, click, ...) work anywhere with --url.')


def cmd_up(args):
    require_linux()
    if not 1 <= args.port <= 65535:
        raise Failure('invalid_input', 'Port must be between 1 and 65535')
    if args.public and not re.fullmatch(r'https://[^/?#@\\\s]+', args.public):
        raise Failure('invalid_input', '--public must be an HTTPS origin like https://desk.example.com', 'No path, query or credentials.')
    if bool(args.tls_cert) != bool(args.tls_key):
        raise Failure('invalid_input', '--tls-cert and --tls-key go together')
    directory = state_dir(args.name)
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    directory.chmod(0o700)
    ready_fd = int(os.environ.pop('RELAY_READY_FD', '-1'))
    if args.detach and ready_fd < 0:
        lock(args.name, directory).close()
        return detach(args, directory)

    def report(data):
        nonlocal ready_fd
        if ready_fd >= 0:
            os.write(ready_fd, (json.dumps(data) + '\n').encode())
            os.close(ready_fd)
            ready_fd = -1
            return True
        return False

    def stop(signum, frame):
        raise KeyboardInterrupt

    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, stop)
    try:
        held = lock(args.name, directory)
    except Failure as failure:
        report({'error': failure.payload()})
        raise
    reap(directory, read_session(args.name))
    session = Session(args, directory)
    final = {'state': 'stopped'}
    try:
        session.save()
        info = session.start()
        if not report(info):
            emit(args, info, ready_text(info, args) + '\nStop with Ctrl-C or `relay down`.')
        session.supervise()
    except KeyboardInterrupt:
        return 0
    except Exception as error:
        failure = error if isinstance(error, Failure) else Failure(
            'internal', f'{type(error).__name__}: {error}', 'Run `relay doctor`.', logs=str(directory))
        final = {'state': 'failed', 'error': failure.payload()}
        report({'error': failure.payload()})
        raise failure from None
    finally:
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(sig, signal.SIG_IGN)
        session.cleanup()
        session.save(stopped=time.time(), **final)
        held.close()


def detach(args, directory):
    """Run the supervisor in the background and wait for its readiness handshake."""
    read_fd, write_fd = os.pipe()
    log_path = directory / 'supervisor.log'
    with open(log_path, 'wb') as log:
        process = subprocess.Popen([sys.executable, str(LAUNCHER_DIR / 'relay'), *sys.argv[1:]], pass_fds=(write_fd,),
                                   env=dict(os.environ, RELAY_READY_FD=str(write_fd)), stdin=subprocess.DEVNULL,
                                   stdout=log, stderr=log, start_new_session=True)
    os.close(write_fd)
    data, deadline = b'', time.monotonic() + args.timeout + 30
    with os.fdopen(read_fd, 'rb', buffering=0) as stream:
        while time.monotonic() < deadline:
            if not select.select([stream], [], [], 1)[0]:
                continue
            chunk = stream.read(65536)
            if not chunk:
                break
            data += chunk
    if not data:
        if process.poll() is None:
            process.terminate()
            raise Failure('timeout', 'Background supervisor did not report readiness in time', f'See {log_path}.',
                          component='supervisor', log=tail(log_path), logs=str(directory))
        raise Failure('component_failed', 'Background supervisor exited before it was ready', f'See {log_path}.',
                      component='supervisor', log=tail(log_path), logs=str(directory))
    result = json.loads(data.decode().splitlines()[-1])
    if 'error' in result:
        error = result['error']
        raise Failure(error.pop('code'), error.pop('message'), error.pop('hint', ''), **error)
    emit(args, result, ready_text(result, args) + f'\nRunning in the background; stop with `relay down --name {args.name}`.')
    return 0


def cmd_down(args):
    require_linux()
    directory, session = state_dir(args.name), read_session(args.name)
    supervisor = (session or {}).get('supervisor')
    running = alive(supervisor)
    if running:
        os.kill(supervisor['pid'], signal.SIGTERM)
        deadline = time.monotonic() + 20
        while alive(supervisor) and time.monotonic() < deadline:
            time.sleep(0.1)
        if alive(supervisor):
            os.kill(supervisor['pid'], signal.SIGKILL)
            while alive(supervisor):
                time.sleep(0.05)
    if session:
        try:
            held = lock(args.name, directory)
        except Failure:
            held = None
        if held:
            with held:
                session = read_session(args.name) or {}
                if session.get('supervisor') == supervisor:
                    reap(directory, session)
                    if session.get('state') in ('starting', 'ready'):
                        session.update(state='stopped', stopped=time.time())
                        write_session(directory, session)
    emit(args, {'name': args.name, 'stopped': running},
         f'Stopped "{args.name}"' if running else f'"{args.name}" was not running')
    return 0


def cmd_status(args):
    if args.url or os.environ.get('RELAY_URL'):
        where = target(args)
        data = {'url': where[0], 'capabilities': http(where, '/capabilities', args.timeout),
                'metrics': http(where, '/metrics', args.timeout)}
        caps = data['capabilities']
        emit(args, data, f'{where[0]}: up ({caps.get("backend")} {caps.get("width")}x{caps.get("height")}, '
                         f'{data["metrics"].get("frames_encoded")} frames encoded)')
        return 0
    session = read_session(args.name)
    if not session:
        raise Failure('not_running', f'No session named "{args.name}"', 'Start one with `relay up -d`.')
    running = alive(session.get('supervisor'))
    if session.get('state') in ('starting', 'ready') and not running:
        session['state'] = 'dead'
    session.pop('components', None)
    session['running'] = running and session.get('state') == 'ready'
    if args.show_token and session.get('tokenFile') and running:
        session['token'] = Path(session['tokenFile']).read_text().strip()
    if session['running']:
        try:
            session['capabilities'] = http(target(args), '/capabilities', args.timeout)
        except Failure as failure:
            session['health'] = failure.payload()
    lines = [f'{args.name}: {session["state"]}']
    for key in ('url', 'display', 'logs', 'token'):
        if session.get(key):
            lines.append(f'  {key + ":":9}{session[key]}')
    if session.get('error'):
        error = session['error']
        lines += [f'  error:   {error["message"]}', f'  hint:    {error.get("hint", "")}']
        if error.get('log'):
            lines.append('  last log lines:\n' + '\n'.join('    ' + l for l in error['log'].splitlines()))
    emit(args, session, '\n'.join(lines))
    return 0 if session['running'] else 3


def cmd_logs(args):
    directory = state_dir(args.name)
    files = [directory / f'{c}.log' for c in ([args.component] if args.component else COMPONENTS)]
    files = [f for f in files if f.exists()]
    if not files:
        raise Failure('not_running', f'No logs for "{args.name}"', 'Start a session with `relay up`.')
    if args.json:
        if args.follow:
            raise Failure('invalid_input', '--follow cannot be combined with --json')
        emit(args, {f.stem: tail(f, 200) for f in files}, '')
        return 0
    os.execvp('tail', ['tail', '-n', '200', *(['-F'] if args.follow else []), *map(str, files)])


def cmd_run(args):
    require_linux()
    command = args.app[1:] if args.app[:1] == ['--'] else args.app
    if not command:
        raise Failure('invalid_option', 'Name the app to start', 'Example: relay run -- mousepad notes.txt')
    if not shutil.which(command[0]):
        raise Failure('missing_dependency', f'{command[0]} not found', f'Install it first, for example: sudo apt install {command[0]}')
    session = read_session(args.name)
    if not session or session.get('state') != 'ready' or not alive(session.get('supervisor')):
        raise Failure('not_found', f'No running session named "{args.name}"', 'Start one with `relay up -d`.')
    directory = state_dir(args.name)
    if session.get('ownsDisplay', True):
        env = desktop_env(directory)
        env.update(session.get('environment', {}))
    else:
        env = dict(os.environ, RELAY_SESSION=str(directory))
    env['DISPLAY'] = session['display']
    if session.get('xauthority'):
        env['XAUTHORITY'] = session['xauthority']
    path = directory / 'apps.log'
    with open(path, 'ab') as log:
        try:
            if args.restart:
                pid = start_watcher(command, env, log)
            else:
                process = subprocess.Popen(command, env=env, cwd=Path.home(), stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                           start_new_session=True, preexec_fn=clear_ambient_caps)
                pid = process.pid
        except OSError as error:
            raise Failure('spawn_failed', f'Cannot start {command[0]}: {error}') from None
    if not args.restart:
        try:
            code = process.wait(1)
        except subprocess.TimeoutExpired:
            code = None
        if code:
            raise Failure('component_failed', f'{command[0]} exited with code {code}', 'Read `relay logs apps`.',
                          component='apps', log=tail(path))
    emit(args, {'pid': pid, 'command': command, 'display': session['display'], 'log': str(path)},
         f'Started {command[0]} (pid {pid}) on {session["display"]}; output in {path}')
    return 0
