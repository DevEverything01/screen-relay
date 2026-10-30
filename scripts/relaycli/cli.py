"""Argument parser, entry point and error printing."""
import argparse
import json
import sys

from .common import DEFAULT_PORT, Failure
from .doctor import cmd_doctor
from .input_commands import cmd_click, cmd_input, cmd_key, cmd_move, cmd_screenshot, cmd_scroll, cmd_type
from .session_commands import COMPONENTS, cmd_down, cmd_logs, cmd_run, cmd_status, cmd_up


class Parser(argparse.ArgumentParser):
    """ArgumentParser that raises usage errors as Failures so --json reports them as JSON."""

    def error(self, message):
        raise Failure('invalid_input', message, f'Run `{self.prog} --help`.')


def parser():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument('--json', action='store_true', help='print machine-readable JSON')
    named = argparse.ArgumentParser(add_help=False)
    named.add_argument('--name', default='default', help='session name (default: default)')
    client = argparse.ArgumentParser(add_help=False, parents=[common, named])
    client.add_argument('--url', help='engine origin (env RELAY_URL; default: the local session)')
    client.add_argument('--token-file', help='file holding the token (env RELAY_TOKEN_FILE)')
    client.add_argument('--timeout', type=float, default=10, help='request timeout in seconds (default: 10)')
    main = Parser(prog='relay', description='Start a streamed Linux desktop and drive it from anywhere.',
                                   epilog='Coordinates are fractions of the screen from 0 to 1. Run `relay COMMAND --help` for details.')
    commands = main.add_subparsers(dest='command', required=True, metavar='COMMAND')

    def add(name, function, help, parents):
        command = commands.add_parser(name, help=help, description=help, parents=parents)
        command.set_defaults(function=function)
        return command

    up = add('up', cmd_up, 'start a display, desktop and engine (foreground; -d for background)', [common, named])
    up.add_argument('-d', '--detach', action='store_true', help='run in the background and return once ready')
    up.add_argument('--config', metavar='FILE', help='config file (env RELAY_CONFIG; default: ~/.config/relay/config.yaml)')
    up.add_argument('--port', type=int, default=None, help=f'engine port (default: {DEFAULT_PORT})')
    up.add_argument('--desktop', help='xfce (default), none, or a command to run as the desktop')
    up.add_argument('--display', help='attach to an existing X display such as :0 instead of starting Xvfb')
    up.add_argument('--public', metavar='HTTPS_URL', help='serve behind a TLS proxy at this origin (binds 0.0.0.0, adds a token)')
    up.add_argument('--tls-cert', metavar='FILE', help='serve TLS natively with this certificate')
    up.add_argument('--tls-key', metavar='FILE', help='private key for --tls-cert')
    up.add_argument('--bind', metavar='ADDR', help='listen address (default 127.0.0.1; non-loopback adds a token)')
    up.add_argument('--timeout', type=float, default=30, help='startup timeout in seconds (default: 30)')
    add('down', cmd_down, 'stop a session (safe to repeat)', [common, named])
    status = add('status', cmd_status, 'show a local session, or a remote engine with --url', [client])
    status.add_argument('--show-token', action='store_true', help='include the session token')
    logs = add('logs', cmd_logs, 'print component logs', [common, named])
    logs.add_argument('component', nargs='?', choices=COMPONENTS)
    logs.add_argument('-f', '--follow', action='store_true', help='keep printing new lines')
    add('doctor', cmd_doctor, 'check this machine and print fix commands', [common])
    run = add('run', cmd_run, 'start an app on the session desktop (output: logs apps)', [common, named])
    run.add_argument('--restart', action='store_true', help='restart the app when it exits')
    run.add_argument('app', nargs=argparse.REMAINDER, metavar='-- APP [ARGS...]')
    screenshot = add('screenshot', cmd_screenshot, 'save a PNG of the screen', [client])
    screenshot.add_argument('file', nargs='?', default='screen.png', help='output file, or - for stdout (default: screen.png)')
    click = add('click', cmd_click, 'click at X Y', [client])
    move = add('move', cmd_move, 'move the pointer to X Y', [client])
    scroll = add('scroll', cmd_scroll, 'scroll at X Y by wheel notches', [client])
    for command in (click, move, scroll):
        command.add_argument('x', type=float)
        command.add_argument('y', type=float)
    click.add_argument('--button', choices=('left', 'middle', 'right'), default='left')
    scroll.add_argument('--dx', type=int, default=0, help='notches right (negative: left)')
    scroll.add_argument('--dy', type=int, default=0, help='notches down (negative: up)')
    key = add('key', cmd_key, 'press key combos such as ctrl+l or Enter', [client])
    key.add_argument('combos', nargs='+', metavar='COMBO')
    for name, function, help, dest in (('type', cmd_type, 'type text (US layout)', 'text'),
                                       ('input', cmd_input, 'send a JSON array of SDK input events', 'events')):
        command = add(name, function, help, [client])
        command.add_argument(dest, nargs='?')
        command.add_argument('--stdin', action='store_true', help='read from standard input')
    return main


def main():
    json_mode = '--json' in sys.argv[1:]
    try:
        args = parser().parse_args()
        json_mode = args.json
    except Failure as failure:
        print_failure(failure, json_mode)
        return 2
    try:
        return args.function(args) or 0
    except Failure as failure:
        print_failure(failure, json_mode)
        return 1
    except KeyboardInterrupt:
        return 130


def print_failure(failure, json_mode):
    """Print a Failure on stderr as JSON or as human text with its hint and log tail."""
    if json_mode:
        print(json.dumps({'error': failure.payload()}), file=sys.stderr)
        return
    print(f'error: {failure.message}', file=sys.stderr)
    if failure.hint:
        print(f'hint: {failure.hint}', file=sys.stderr)
    if failure.extra.get('log'):
        print(f'last lines of the {failure.extra.get("component", "")} log:\n{failure.extra["log"]}', file=sys.stderr)
