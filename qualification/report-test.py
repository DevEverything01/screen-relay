"""Run with python3 qualification/report-test.py; uses temporary fixtures only."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('report', Path(__file__).with_name('report.py'))
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


class ReportTests(unittest.TestCase):
    def test_values_and_motion_coverage(self):
        self.assertEqual(report.format_values([3, 1, 2]), '2.000 [1.000–3.000], n=3')
        self.assertEqual(report.format_values([None, float('nan')]), 'unmeasured')
        work = {'motionQuality': {'valid': True, 'pairs': [{}, {}],
                                  'source': [{}, {}, {}], 'decoded': [{}],
                                  'summary': {'medianPsnrDb': 21}}}
        values = report.extract(work, [10, 20, 30])
        self.assertEqual(values['motionPairs'], 2)
        self.assertEqual(values['motionSourceSamples'], 3)
        self.assertEqual(values['motionDecodedSamples'], 1)
        self.assertEqual(values['latencyMedian'], 20)
        self.assertEqual(values['latencyP95'], 30)
        work['motionQuality'].update(source={'samples': 77}, decoded={'samples': 140})
        values = report.extract(work, [])
        self.assertEqual(values['motionSourceSamples'], 77)
        self.assertEqual(values['motionDecodedSamples'], 140)

    def test_exclusion_and_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            valid = {'valid': True, 'engine': 'native',
                     'imageId': 'image-proof', 'runnerSha256': 'runner-proof',
                     'fixtureSha256': 'fixture-proof',
                     'text': {'psnrDb': 38, 'textInkMeanAbsoluteError': 4.1},
                     'runs': {'video': {'valid': True, 'cpuPercent': 12}}}
            (root/'valid.json').write_text(json.dumps(valid))
            (root/'invalid.json').write_text(json.dumps({'valid': False, 'errors': ['timeout-proof']}))
            manifest = {'title': 'Fixture', 'finalImage': 'final-image', 'finalSourceCommit': 'commit',
                        'selectedRuns': [{'label': 'candidate', 'kind': 'candidate', 'raw': 'valid.json',
                                          'profile': 'original-fixture'},
                                         {'label': 'rejected', 'kind': 'reference', 'raw': 'invalid.json'}],
                        'verification': [], 'limitations': [], 'notes': []}
            path = root/'manifest.json'
            path.write_text(json.dumps(manifest))
            self.assertEqual(report.export(path, root/'out', root),
                             {'selected': 2, 'excluded': 1, 'groups': 1})
            markdown = (root/'out/general-engine-report.md').read_text()
            for expected in ['timeout-proof', 'image-proof', 'runner-proof', 'fixture-proof',
                             '12.000 [12.000–12.000], n=1', 'entire run excluded',
                             'evidence/general/valid.json', '## original-fixture / video',
                             'Original static-text ink MAE', '4.100 [4.100–4.100], n=1',
                             'Original static-text PSNR (dB)', '38.000 [38.000–38.000], n=1']:
                self.assertIn(expected, markdown)
            self.assertIn('| Frozen PSNR (dB) | unmeasured |', markdown)
            (root/'valid.json').write_text('{malformed')
            with self.assertRaises(json.JSONDecodeError):
                report.export(path, root/'out', root)


if __name__ == '__main__':
    unittest.main()
