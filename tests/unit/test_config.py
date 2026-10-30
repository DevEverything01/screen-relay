"""Tests for config file loading, validation and flag precedence."""
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))

from relaycli.common import Failure
from relaycli.config import apply_to, load


class ConfigTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)

    def write(self, text):
        path = Path(self.directory.name) / 'config.yaml'
        path.write_text(text)
        return path

    def test_valid_file(self):
        path = self.write("""
display:
  resolution: 1600x900
stream:
  fps: 30
  bitrate:
    min: 500k
    start: 4M
    max: 20M
server:
  port: 9090
  bind: 0.0.0.0
  public: https://desk.example.com
  tls_cert: /tmp/fullchain.pem
  tls_key: /tmp/key.pem
desktop: none
""")
        settings, source, present = load(str(path))
        self.assertEqual(source, path)
        self.assertEqual(settings['display']['resolution'], '1600x900')
        self.assertEqual(settings['stream']['fps'], 30)
        self.assertEqual(settings['stream']['bitrate'], {'min': 500000, 'start': 4000000, 'max': 20000000})
        self.assertEqual(settings['server']['port'], 9090)
        self.assertEqual(settings['server']['bind'], '0.0.0.0')
        self.assertEqual(settings['server']['public'], 'https://desk.example.com')
        self.assertEqual(settings['server']['tls_cert'], '/tmp/fullchain.pem')
        self.assertEqual(settings['server']['tls_key'], '/tmp/key.pem')
        self.assertEqual(settings['desktop'], 'none')
        self.assertIn('display.resolution', present)

    def test_unknown_key_names_path_and_valid_keys(self):
        with self.assertRaises(Failure) as caught:
            load(str(self.write("stream:\n  fsp: 30\n")))
        self.assertIn('stream.fsp', caught.exception.message)
        self.assertIn('fps', caught.exception.hint)
        self.assertIn('bitrate', caught.exception.hint)

    def test_resolution_must_be_even_and_in_range(self):
        with self.assertRaises(Failure) as caught:
            load(str(self.write("display:\n  resolution: 1281x720\n")))
        self.assertIn('display.resolution', caught.exception.message)
        self.assertIn('even', caught.exception.message)
        with self.assertRaises(Failure) as caught:
            load(str(self.write("display:\n  resolution: 2000x1080\n")))
        self.assertIn('display.resolution', caught.exception.message)
        self.assertIn('320..1920', caught.exception.message)

    def test_bitrate_suffix_and_order(self):
        settings, _, _ = load(str(self.write("stream:\n  bitrate:\n    min: 250k\n    start: 8M\n    max: 40M\n")))
        self.assertEqual(settings['stream']['bitrate'], {'min': 250000, 'start': 8000000, 'max': 40000000})
        with self.assertRaises(Failure) as caught:
            load(str(self.write("stream:\n  bitrate:\n    min: 10M\n    start: 1M\n    max: 40M\n")))
        self.assertIn('min <= start <= max', caught.exception.message)

    def test_flags_beat_file(self):
        settings, _, present = load(str(self.write("server:\n  port: 9090\n  bind: 0.0.0.0\ndesktop: none\n")))
        args = SimpleNamespace(port=9000, bind=None, public=None, tls_cert=None, tls_key=None, desktop=None)
        apply_to(args, settings, present)
        self.assertEqual(args.port, 9000)
        self.assertEqual(args.bind, '0.0.0.0')
        self.assertEqual(args.desktop, 'none')


    def test_bind_only_comes_from_file_when_set(self):
        args = SimpleNamespace(port=None, bind=None, public='https://desk.example.com', tls_cert=None, tls_key=None, desktop=None)
        settings, _, present = load(str(self.write("server:\n  port: 9090\n")))
        apply_to(args, settings, present)
        self.assertIsNone(args.bind)
        settings, _, present = load(str(self.write("server:\n  bind: 192.168.1.5\n")))
        apply_to(args, settings, present)
        self.assertEqual(args.bind, '192.168.1.5')
        args = SimpleNamespace(port=None, bind='10.0.0.1', public=None, tls_cert=None, tls_key=None, desktop=None)
        apply_to(args, settings, present)
        self.assertEqual(args.bind, '10.0.0.1')


if __name__ == '__main__':
    unittest.main()
