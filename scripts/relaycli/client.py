"""HTTP client for the engine and input sending."""
import json
import os
from pathlib import Path
import re
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request

from .common import DEFAULT_PORT, MAX_BATCH, Failure
from .keys import batches, encode
from .state import read_session

TOKEN = re.compile(r'[0-9a-f]{64}')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Refuse redirects so credentials never reach another origin."""

    def redirect_request(self, *args, **kwargs):
        raise Failure('invalid_input', 'Server answered with a redirect; refusing to follow it', 'Use the server origin directly.')


def check_url(url, token):
    """Apply the SDK rules: HTTPS or loopback HTTP origin, no credentials or path, token for remote hosts."""
    try:
        parsed = urllib.parse.urlsplit(url)
        parsed.port
    except ValueError:
        parsed = None
    local = parsed is not None and parsed.hostname in ('localhost', '127.0.0.1')
    if not parsed or parsed.scheme not in ('http', 'https') or (not local and parsed.scheme != 'https') or not parsed.hostname \
            or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        raise Failure('invalid_input', f'Invalid server URL: {url}', 'Use an HTTPS origin or http://127.0.0.1:PORT.')
    if (token is not None and not TOKEN.fullmatch(token)) or (not local and not token):
        raise Failure('invalid_input', 'Remote servers need a 64-character lowercase hex token',
                      'Pass --token-file FILE or set RELAY_TOKEN_FILE.')
    return url.rstrip('/')


def connect_host(bind):
    """Address a local client dials for this listen address, or None for 127.0.0.1."""
    if bind in ('127.0.0.1', '0.0.0.0', '::', None):
        return None
    return f'[{bind}]' if ':' in bind else bind


def target(args):
    """Resolve (url, token, cafile, connect) from flags, environment, or the local session state."""
    url = args.url or os.environ.get('RELAY_URL')
    token_file = args.token_file or os.environ.get('RELAY_TOKEN_FILE')
    cafile = connect = None
    if not url:
        session = read_session(args.name) or {}
        if session.get('state') == 'ready':
            url, cafile, connect = session['localUrl'], session.get('tlsCert'), connect_host(session.get('bind'))
            token_file = token_file or session.get('tokenFile')
        else:
            url = f'http://127.0.0.1:{DEFAULT_PORT}'
    token = None
    if token_file:
        try:
            token = Path(token_file).read_text().strip()
        except OSError as error:
            raise Failure('invalid_input', f'Cannot read token file: {error}', 'Check --token-file.')
    return check_url(url, token), token, cafile, connect


def http(where, path, timeout, body=None, binary=False):
    """One request to the engine; maps HTTP and network errors to Failures."""
    url, token, cafile, connect = where
    headers = {'Authorization': 'Bearer ' + token} if token else {}
    request_url = url
    if connect:
        parts = urllib.parse.urlsplit(url)
        headers['Host'] = parts.netloc
        request_url = parts._replace(netloc=f'{connect}:{parts.port}').geturl()
    context = None
    if cafile:
        context = ssl.create_default_context(cafile=cafile)
        context.check_hostname = False
    opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=context))
    request = urllib.request.Request(request_url + path, data=body, headers=headers, method='GET' if body is None else 'POST')
    try:
        with opener.open(request, timeout=timeout) as response:
            data = response.read(8 * 1024 * 1024 + 1)
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read(4096))
        except ValueError:
            detail = {}
        known = {
            401: ('unauthorized', 'Token missing or wrong', 'Pass --token-file FILE or set RELAY_TOKEN_FILE.'),
            403: ('unauthorized', 'Rejected by the Host/Origin policy', 'Connect through a loopback address or the configured public URL.'),
            409: ('busy', 'A viewer or SDK session holds control', 'Close it and run the command again; input is never retried.'),
            413: ('invalid_input', 'Input batch too large', f'Send at most {MAX_BATCH} events per batch.'),
            503: ('busy', 'Engine busy or screenshot unavailable', 'Try again in a moment.'),
        }
        code, message, hint = known.get(error.code, ('internal', f'Engine returned HTTP {error.code}', ''))
        if 'index' in detail:
            code, message, hint = ('invalid_input', f'Engine rejected input event {detail["index"]} ({detail.get("error")})',
                                   'Check the event against the SDK input schema.')
        raise Failure(code, message, hint) from None
    except (urllib.error.URLError, OSError) as error:
        reason = getattr(error, 'reason', error)
        if isinstance(reason, (TimeoutError, socket.timeout)):
            raise Failure('timeout', f'No reply from {url} within {timeout:g}s', 'Raise --timeout or check the engine.') from None
        raise Failure('unreachable', f'Cannot reach {url}: {reason}', 'Start a session with `relay up` or pass --url.') from None
    if len(data) > 8 * 1024 * 1024:
        raise Failure('internal', 'Response exceeds 8 MiB')
    if binary:
        return data
    try:
        return json.loads(data)
    except ValueError:
        raise Failure('internal', 'Engine returned invalid JSON') from None


def send(args, groups):
    """Send event groups as bounded POST /input batches; reports how many events were applied."""
    where, applied = target(args), 0
    payloads = [b''.join(encode(e) for e in batch) for batch in batches(groups)]
    for payload in payloads:
        try:
            applied += http(where, '/input', args.timeout, body=payload)['applied']
        except Failure as failure:
            failure.extra['applied'] = applied
            raise
    return applied
