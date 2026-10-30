"""Config file loading, validation and command-line precedence."""
import copy
import os
from pathlib import Path
import re

from .common import DEFAULT_PORT, Failure

DEFAULTS = {
    'display': {'resolution': '1280x720'},
    'stream': {'fps': 60, 'bitrate': {'min': 1000000, 'start': 8000000, 'max': 40000000}},
    'server': {'port': DEFAULT_PORT, 'bind': '127.0.0.1', 'public': None, 'tls_cert': None, 'tls_key': None},
    'desktop': 'xfce',
}

SECTIONS = {
    'display': ('resolution',),
    'stream': ('fps', 'bitrate'),
    'server': ('port', 'bind', 'public', 'tls_cert', 'tls_key'),
}
ROOT_KEYS = ('display', 'stream', 'server', 'desktop')
BITRATE_KEYS = ('min', 'start', 'max')

RESOLUTION = re.compile(r'(\d+)x(\d+)')
BITRATE = re.compile(r'(\d+)([kM]?)')


def locate(path=None):
    """Return the config file to read and whether it was named explicitly."""
    if path:
        return Path(path).expanduser(), True
    environment = os.environ.get('RELAY_CONFIG')
    if environment:
        return Path(environment).expanduser(), True
    default = Path(os.environ.get('XDG_CONFIG_HOME') or Path.home() / '.config') / 'relay' / 'config.yaml'
    return (default if default.is_file() else None), False


def load(path=None):
    """Load the config file over the defaults; returns settings, the source path and the keys it set."""
    source, required = locate(path)
    settings = copy.deepcopy(DEFAULTS)
    present = set()
    if source is not None:
        if not source.is_file():
            if required:
                raise Failure('invalid_input', f'Config file not found: {source}',
                              'Check --config or RELAY_CONFIG.')
            source = None
        else:
            apply(settings, read(source), present)
    return settings, source, present


def read(source):
    """Read and parse one YAML config file into a mapping."""
    try:
        import yaml
    except ImportError:
        raise Failure('missing_dependency', 'PyYAML is not installed', 'Install it with: sudo apt install python3-yaml') from None
    try:
        text = source.read_text()
    except OSError as error:
        raise Failure('invalid_input', f'Cannot read config file {source}: {error}',
                      'Check --config or RELAY_CONFIG.') from None
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as error:
        raise Failure('invalid_input', f'Cannot parse config file {source}: {error}', 'Fix the YAML syntax.') from None
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise Failure('invalid_input', f'Config file {source} must be a mapping at the top level')
    return data


def apply(settings, data, present):
    """Validate a parsed config file and copy its values over the defaults."""
    check_keys(data, ROOT_KEYS, '')
    for section, allowed in SECTIONS.items():
        if section not in data:
            continue
        block = data[section]
        if not isinstance(block, dict):
            wrong(section, block, 'a mapping')
        check_keys(block, allowed, section)
        for key in allowed:
            if key not in block:
                continue
            path = f'{section}.{key}'
            if key == 'bitrate':
                bitrates(settings, block[key])
            else:
                settings[section][key] = validators[path](block[key], path)
            present.add(path)
    if 'desktop' in data:
        settings['desktop'] = text_value(data['desktop'], 'desktop')
        present.add('desktop')
    check_bitrate_order(settings)


def check_keys(data, allowed, prefix):
    base = prefix + '.' if prefix else ''
    for key in data:
        if key not in allowed:
            raise Failure('invalid_input', f'Unknown config key "{base}{key}"',
                          f'Valid keys at {prefix or "the top level"}: {", ".join(allowed)}.')


def wrong(path, value, expected):
    raise Failure('invalid_input', f'Invalid config value for {path}: {value!r}; expected {expected}')


def out_of_range(path, value, low, high):
    raise Failure('invalid_input', f'Invalid config value for {path}: {value!r}; allowed {low}..{high}',
                  f'Set {path} between {low} and {high}.')


def integer(value, path, low, high):
    if isinstance(value, bool) or not isinstance(value, int):
        wrong(path, value, 'an integer')
    if not low <= value <= high:
        out_of_range(path, value, low, high)
    return value


def text_value(value, path):
    if not isinstance(value, str):
        wrong(path, value, 'a string')
    return value


def resolution(value, path):
    if not isinstance(value, str):
        wrong(path, value, 'WIDTHxHEIGHT such as 1280x720')
    match = RESOLUTION.fullmatch(value.strip())
    if not match:
        wrong(path, value, 'WIDTHxHEIGHT such as 1280x720')
    width, height = int(match.group(1)), int(match.group(2))
    if width % 2 or height % 2:
        raise Failure('invalid_input', f'Invalid config value for {path}: {value!r}; width and height must be even')
    if not 320 <= width <= 1920 or not 240 <= height <= 1080:
        raise Failure('invalid_input', f'Invalid config value for {path}: {value!r}; allowed width 320..1920, height 240..1080')
    return f'{width}x{height}'


def bitrate(value, path):
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        wrong(path, value, 'an integer in bits per second, or one with a k or M suffix')
    if isinstance(value, int):
        number = value
    else:
        match = BITRATE.fullmatch(value.strip())
        if not match:
            wrong(path, value, 'an integer in bits per second, or one with a k or M suffix such as 8M')
        number = int(match.group(1)) * {'': 1, 'k': 1000, 'M': 1000000}[match.group(2)]
    if not 250000 <= number <= 100000000:
        out_of_range(path, value, 250000, 100000000)
    return number


def bitrates(settings, block):
    if not isinstance(block, dict):
        wrong('stream.bitrate', block, 'a mapping with min, start and max')
    check_keys(block, BITRATE_KEYS, 'stream.bitrate')
    for key in BITRATE_KEYS:
        if key in block:
            settings['stream']['bitrate'][key] = bitrate(block[key], f'stream.bitrate.{key}')


def check_bitrate_order(settings):
    values = settings['stream']['bitrate']
    if not values['min'] <= values['start'] <= values['max']:
        raise Failure('invalid_input', f'Invalid config value for stream.bitrate: min {values["min"]}, '
                                       f'start {values["start"]}, max {values["max"]}; require min <= start <= max',
                      'Set stream.bitrate.min, stream.bitrate.start and stream.bitrate.max in that order.')


validators = {
    'display.resolution': resolution,
    'stream.fps': lambda value, path: integer(value, path, 10, 60),
    'server.port': lambda value, path: integer(value, path, 1, 65535),
    'server.bind': text_value,
    'server.public': text_value,
    'server.tls_cert': text_value,
    'server.tls_key': text_value,
}


def apply_to(args, settings, present):
    """Put the config values on parsed up arguments, leaving every flag the user set untouched."""
    if args.port is None:
        args.port = settings['server']['port']
    if args.bind is None and 'server.bind' in present:
        args.bind = settings['server']['bind']
    if args.public is None:
        args.public = settings['server']['public']
    if args.tls_cert is None:
        args.tls_cert = settings['server']['tls_cert']
    if args.tls_key is None:
        args.tls_key = settings['server']['tls_key']
    if args.desktop is None and 'desktop' in present:
        args.desktop = settings['desktop']
    args.resolution = settings['display']['resolution']
    args.fps = settings['stream']['fps']
    args.bitrate_min = settings['stream']['bitrate']['min']
    args.bitrate_start = settings['stream']['bitrate']['start']
    args.bitrate_max = settings['stream']['bitrate']['max']
