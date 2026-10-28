"""Shared constants, the Failure error type and output helper."""
import json
from pathlib import Path

DEFAULT_PORT = 8080
MAX_BATCH = 256
LAUNCHER_DIR = Path(__file__).resolve().parent.parent


class Failure(Exception):
    """A user-facing error with a stable code, a fix hint and optional component details."""

    def __init__(self, code, message, hint='', **extra):
        super().__init__(message)
        self.code, self.message, self.hint, self.extra = code, message, hint, extra

    def payload(self):
        return {'code': self.code, 'message': self.message, 'hint': self.hint, **self.extra}


def emit(args, data, text):
    """Print the JSON object with --json, otherwise the human text."""
    print(json.dumps(data) if args.json else text, flush=True)
