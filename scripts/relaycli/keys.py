"""HID key tables and the encoding of SDK input events."""
import json
import math
import struct

from .common import MAX_BATCH, Failure


TYPES = {'keyDown': 1, 'keyUp': 2, 'pointerMove': 3, 'buttonDown': 4, 'buttonUp': 5, 'wheel': 6, 'releaseAll': 7}
US_KEYS = {c: 4 + i for i, c in enumerate('abcdefghijklmnopqrstuvwxyz1234567890')}
US_KEYS.update({'\n': 40, '\t': 43, ' ': 44})
US_KEYS.update({c: 45 + i for i, c in enumerate('-=[]\\')})
US_KEYS.update({c: 51 + i for i, c in enumerate(';\'`,./')})
SHIFTED = dict(zip('!@#$%^&*()_+{}|:"~<>?', '1234567890-=[]\\;\'`,./'))
MODIFIERS = {'ctrl': 224, 'control': 224, 'shift': 225, 'alt': 226, 'super': 227, 'meta': 227, 'cmd': 227, 'win': 227}
NAMED_KEYS = {'enter': 40, 'return': 40, 'escape': 41, 'esc': 41, 'backspace': 42, 'tab': 43, 'space': 44,
              'capslock': 57, 'printscreen': 70, 'scrolllock': 71, 'pause': 72, 'insert': 73, 'home': 74,
              'pageup': 75, 'delete': 76, 'end': 77, 'pagedown': 78, 'right': 79, 'left': 80, 'down': 81,
              'up': 82, 'menu': 101, 'arrowright': 79, 'arrowleft': 80, 'arrowdown': 81, 'arrowup': 82}
NAMED_KEYS.update({f'f{n}': 57 + n for n in range(1, 13)})
NAMED_KEYS.update({f'f{n}': 91 + n for n in range(13, 25)})


def number(value, name, low, high, integer=False):
    """Validate a JSON number the way the SDK does (finite, in range, optionally integral)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) \
            or not low <= value <= high or (integer and value != int(value)):
        raise Failure('invalid_input', f'Invalid {name}: {value!r}', f'Expected a number from {low} to {high}.')
    return value


def encode(event):
    """Encode one SDK-schema input event as the engine's 16-byte record (bytes 20-35 of sdk encodeInput)."""
    kind = TYPES.get(event.get('type')) if isinstance(event, dict) and isinstance(event.get('type'), str) else None
    if not kind:
        raise Failure('invalid_input', f'Unknown input event: {json.dumps(event)}', 'Types: ' + ', '.join(TYPES))
    code = value = x = y = 0
    if kind <= 2:
        code = int(number(event.get('key'), 'key', 0, 231, True))
    if 3 <= kind <= 6:
        x, y = (math.floor(number(event.get(a), a, 0, 1) * 65535 + 0.5) for a in 'xy')
    if kind in (4, 5):
        code = int(number(event.get('button'), 'button', 1, 3, True))
    if kind == 6:
        if event.get('axis') not in ('vertical', 'horizontal'):
            raise Failure('invalid_input', 'Invalid wheel axis', 'Use "vertical" or "horizontal".')
        value = int(number(event.get('delta'), 'wheel delta', -1200, 1200, True))
        if value % 120:
            raise Failure('invalid_input', 'Wheel delta must be a multiple of 120', 'One notch is 120.')
        code = 0 if event['axis'] == 'vertical' else 1
    return struct.pack('>BBHiHHHH', kind, 0, code, value, x, y, 0, 0)


def press(key, modifiers=()):
    """Events for pressing and releasing a key while holding modifiers."""
    return ([{'type': 'keyDown', 'key': m} for m in modifiers] + [{'type': 'keyDown', 'key': key}, {'type': 'keyUp', 'key': key}]
            + [{'type': 'keyUp', 'key': m} for m in reversed(modifiers)])


def char_key(char):
    """Map a character to (HID usage, needs shift) on a US layout, or None."""
    if char in US_KEYS:
        return US_KEYS[char], False
    if char.isascii() and char.isupper():
        return US_KEYS[char.lower()], True
    if char in SHIFTED:
        return US_KEYS[SHIFTED[char]], True
    return None


def type_groups(text):
    """One event group per character; rejects the whole text if any character has no US key."""
    keys = [char_key(c) for c in text]
    bad = sorted({repr(c) for c, k in zip(text, keys) if k is None})
    if bad:
        raise Failure('invalid_input', 'Cannot type ' + ', '.join(bad) + ' with a US keyboard layout',
                      'Only printable ASCII, newline and tab can be typed.')
    return [press(k, [225] if shift else []) for k, shift in keys]


def combo_events(spec):
    """Events for a combo like ctrl+l, shift+Tab, Enter or ctrl++."""
    if spec == '+' or spec.endswith('++'):
        held, key = spec[:-2], '+'
    else:
        held, _, key = spec.rpartition('+')
    names = held.split('+') if held else []
    unknown = [n for n in names if n.lower() not in MODIFIERS]
    if unknown or not key:
        raise Failure('invalid_input', f'Invalid key combo "{spec}"', 'Modifiers: ctrl, shift, alt, super. Example: ctrl+shift+t')
    modifiers = [MODIFIERS[n.lower()] for n in names]
    lower = key.lower()
    if lower in NAMED_KEYS or lower in MODIFIERS:
        return press(NAMED_KEYS.get(lower) or MODIFIERS[lower], modifiers)
    mapped = char_key(key) if len(key) == 1 else None
    if not mapped:
        raise Failure('invalid_input', f'Unknown key "{key}"', 'Use a character or a name like Enter, Tab, Escape, Up, F5.')
    return press(mapped[0], modifiers + ([225] if mapped[1] and 225 not in modifiers else []))


def batches(groups):
    """Pack event groups into batches of at most MAX_BATCH records without splitting a group."""
    batch = []
    for group in groups:
        if len(group) > MAX_BATCH:
            raise Failure('invalid_input', f'An input group has more than {MAX_BATCH} events', 'Split the input.')
        if len(batch) + len(group) > MAX_BATCH:
            yield batch
            batch = []
        batch += group
    if batch:
        yield batch
