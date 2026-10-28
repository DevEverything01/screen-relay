"""Session state directory, records, process liveness and cleanup."""
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import time

from .common import Failure


def state_dir(name):
    """Per-session state directory under XDG_STATE_HOME."""
    if not re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}', name):
        raise Failure('invalid_input', f'Invalid session name "{name}"', 'Use letters, digits, ".", "_" or "-".')
    return Path(os.environ.get('XDG_STATE_HOME') or Path.home() / '.local/state') / 'relay' / name


def read_session(name):
    try:
        return json.loads((state_dir(name) / 'session.json').read_text())
    except (OSError, ValueError):
        return None


def write_session(directory, data):
    temporary = directory / 'session.json.tmp'
    temporary.write_text(json.dumps(data, indent=2) + '\n')
    os.replace(temporary, directory / 'session.json')


def tail(path, lines=20):
    try:
        with open(path, 'rb') as stream:
            stream.seek(max(0, os.fstat(stream.fileno()).st_size - 65536))
            return '\n'.join(stream.read().decode(errors='replace').splitlines()[-lines:])
    except OSError:
        return ''


def start_time(pid):
    """Process start time from /proc, or None when the process is gone or a zombie."""
    try:
        stat = Path(f'/proc/{pid}/stat').read_text()
        fields = stat[stat.rindex(')') + 2:].split()
        return None if fields[0] == 'Z' else fields[19]
    except (OSError, ValueError, IndexError):
        return None


def alive(record):
    return bool(record) and start_time(record['pid']) == record['start']


def identity(pid):
    return {'pid': pid, 'start': start_time(pid)}


def sweep(directory):
    """Kill leftover processes that carry this session's marker in their environment."""
    marker = f'RELAY_SESSION={directory}'.encode()
    for sig in (signal.SIGTERM, signal.SIGKILL):
        found = []
        for entry in Path('/proc').iterdir():
            try:
                if entry.name.isdigit() and int(entry.name) != os.getpid() and marker in (entry / 'environ').read_bytes().split(b'\0'):
                    os.kill(int(entry.name), sig)
                    found.append(entry.name)
            except (OSError, ValueError):
                pass
        if not found:
            return
        time.sleep(0.5)


def reap(directory, session):
    """Kill what a previous run of this session left behind; the caller holds the session lock."""
    for record in (session or {}).get('components', {}).values():
        if alive(record):
            try:
                os.killpg(record['pid'], signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
    sweep(directory)


def lock(name, directory):
    """Take the per-session lock that the supervisor holds for its whole life."""
    handle = open(directory / 'lock', 'a')
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        raise Failure('already_running', f'Session "{name}" is already running',
                      f'Stop it with `relay down --name {name}` or pick another --name.') from None
    return handle
