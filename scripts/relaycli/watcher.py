"""Restart an app until its relay session stops."""
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import threading
import time

from .common import LAUNCHER_DIR, Failure
from .state import alive
from .supervisor import clear_ambient_caps


def start_watcher(command, env, log):
    """Detach a watcher and return its first app PID after a successful spawn."""
    read_fd, write_fd = os.pipe()
    watcher = None
    try:
        with os.fdopen(read_fd, 'rb') as stream:
            try:
                watcher = subprocess.Popen([sys.executable, '-m', 'relaycli.watcher', str(write_fd), *command],
                                           cwd=LAUNCHER_DIR, env=env, pass_fds=(write_fd,),
                                           stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True,
                                           preexec_fn=clear_ambient_caps)
            finally:
                os.close(write_fd)
            if not select.select([stream], [], [], 10)[0]:
                raise Failure('timeout', 'App watcher did not report startup', 'Read `relay logs apps`.')
            line = stream.readline()
            if not line:
                raise Failure('spawn_failed', 'App watcher exited before starting the app', 'Read `relay logs apps`.')
            result = json.loads(line)
            if 'error' in result:
                raise Failure('spawn_failed', f'Cannot start {command[0]}: {result["error"]}')
            return result['pid']
    except BaseException:
        if watcher is not None:
            watcher.terminate()
            try:
                watcher.wait(1)
            except subprocess.TimeoutExpired:
                watcher.kill()
                watcher.wait()
        raise


def watch(ready_fd, command):
    """Restart with bounded backoff and stop the app's process group on shutdown."""
    stopping = threading.Event()

    def stop(signum, frame):
        stopping.set()

    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, stop)
    process = None
    delay = 1
    try:
        directory = Path(os.environ['RELAY_SESSION'])
        supervisor = json.loads((directory / 'session.json').read_text()).get('supervisor')
        while not stopping.is_set() and alive(supervisor):
            started = time.monotonic()
            try:
                process = subprocess.Popen(command, cwd=Path.home(), stdin=subprocess.DEVNULL,
                                           start_new_session=True, preexec_fn=clear_ambient_caps)
            except OSError as error:
                if ready_fd is not None:
                    os.write(ready_fd, (json.dumps({'error': str(error)}) + '\n').encode())
                    return 1
                print(f'relay: cannot restart {command[0]}: {error}', flush=True)
            else:
                if ready_fd is not None:
                    os.write(ready_fd, (json.dumps({'pid': process.pid}) + '\n').encode())
                    os.close(ready_fd)
                    ready_fd = None
                else:
                    print(f'relay: restarted {command[0]} (pid {process.pid})', flush=True)
                while not stopping.is_set() and alive(supervisor):
                    try:
                        code = process.wait(0.1)
                        break
                    except subprocess.TimeoutExpired:
                        pass
                else:
                    break
                if time.monotonic() - started >= 60:
                    delay = 1
                print(f'relay: {command[0]} exited with code {code}; restarting in {delay}s', flush=True)
            if stopping.wait(delay):
                break
            delay = min(delay * 2, 30)
    finally:
        if ready_fd is not None:
            os.close(ready_fd)
        if process is not None and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
                time.sleep(0.2)
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
    return 0


if __name__ == '__main__':
    sys.exit(watch(int(sys.argv[1]), sys.argv[2:]))
