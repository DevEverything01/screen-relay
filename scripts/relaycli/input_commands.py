"""screenshot, click, move, scroll, key, type and input commands."""
import json
import os
from pathlib import Path
import struct
import sys

from .client import http, send, target
from .common import MAX_BATCH, Failure, emit
from .keys import combo_events, type_groups


def cmd_screenshot(args):
    data = http(target(args), '/screenshot.png', args.timeout, binary=True)
    if data[:8] != b'\x89PNG\r\n\x1a\n' or len(data) < 24:
        raise Failure('internal', 'Engine did not return a PNG')
    width, height = struct.unpack('>II', data[16:24])
    if args.file == '-':
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
        return 0
    try:
        Path(args.file).write_bytes(data)
    except OSError as error:
        raise Failure('invalid_input', f'Cannot write {args.file}: {error}') from None
    emit(args, {'path': os.path.abspath(args.file), 'bytes': len(data), 'width': width, 'height': height},
         f'Saved {args.file} ({width}x{height}, {len(data)} bytes)')
    return 0


def text_argument(args, value):
    if args.stdin == (value is not None):
        raise Failure('invalid_input', 'Give the argument or --stdin, not both or neither')
    return sys.stdin.read() if args.stdin else value


def finish(args, groups, what):
    applied = send(args, groups)
    emit(args, {'applied': applied}, f'{what} ({applied} events)')
    return 0


def cmd_click(args):
    point = {'x': args.x, 'y': args.y, 'button': {'left': 1, 'middle': 2, 'right': 3}[args.button]}
    return finish(args, [[{'type': 'buttonDown', **point}, {'type': 'buttonUp', **point}]], f'Clicked {args.button} at {args.x:g},{args.y:g}')


def cmd_move(args):
    return finish(args, [[{'type': 'pointerMove', 'x': args.x, 'y': args.y}]], f'Moved to {args.x:g},{args.y:g}')


def cmd_scroll(args):
    if not args.dx and not args.dy:
        raise Failure('invalid_input', 'Nothing to scroll', 'Pass --dy N (positive scrolls down) and/or --dx N.')
    events = [{'type': 'pointerMove', 'x': args.x, 'y': args.y}]
    for axis, notches in (('vertical', args.dy), ('horizontal', args.dx)):
        while notches:
            step = max(-10, min(10, notches))
            events.append({'type': 'wheel', 'axis': axis, 'delta': step * 120, 'x': args.x, 'y': args.y})
            notches -= step
    return finish(args, [events], f'Scrolled dx={args.dx} dy={args.dy}')


def cmd_key(args):
    return finish(args, [combo_events(c) for c in args.combos], 'Pressed ' + ' '.join(args.combos))


def cmd_type(args):
    text = text_argument(args, args.text)
    return finish(args, type_groups(text), f'Typed {len(text)} characters')


def cmd_input(args):
    try:
        events = json.loads(text_argument(args, args.events))
    except ValueError as error:
        raise Failure('invalid_input', f'Invalid JSON: {error}', 'Pass a JSON array of SDK input events.') from None
    if not isinstance(events, list) or not 0 < len(events) <= MAX_BATCH:
        raise Failure('invalid_input', f'Input must be a JSON array of 1 to {MAX_BATCH} events',
                      'Example: [{"type":"keyDown","key":4},{"type":"keyUp","key":4}]')
    return finish(args, [events], 'Sent input')
