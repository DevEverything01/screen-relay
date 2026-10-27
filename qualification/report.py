"""Render explicitly selected qualification evidence; never select or run benchmarks."""
import argparse
import html
import json
import math
from collections import defaultdict
from pathlib import Path
from statistics import median


METRICS = [
    ('CPU (% one core)', 'cpuPercent'), ('RAM (MiB)', 'memoryMiB'),
    ('Container transmit (Mbps)', 'mbps'), ('Visible updates/s', 'visibleUpdatesPerSecond'),
    ('Producer updates/s', 'producerUpdatesPerSecond'),
    ('Observed visual changes/s', 'usefulVisualChangesPerSecond'),
    ('Frozen PSNR (dB)', 'frozenPsnr'), ('Frozen MAE', 'frozenMae'),
    ('Original static-text PSNR (dB)', 'originalTextPsnr'),
    ('Original static-text ink MAE', 'originalTextInkMae'),
    ('Motion median PSNR (dB)', 'motionPsnr'), ('Motion worst-decile PSNR (dB)', 'motionWorstPsnr'),
    ('Motion median MAE', 'motionMae'), ('Motion pairs', 'motionPairs'),
    ('Motion source samples', 'motionSourceSamples'), ('Motion decoded samples', 'motionDecodedSamples'),
    ('Input median (ms)', 'latencyMedian'), ('Input p95 (ms)', 'latencyP95'),
    ('Input trials', 'latencyTrials'),
]


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def format_values(values):
    numbers = [v for v in values if finite(v)]
    if not numbers:
        return 'unmeasured'
    return f'{median(numbers):.3f} [{min(numbers):.3f}–{max(numbers):.3f}], n={len(numbers)}'


def extract(work, latency):
    values = {k: work.get(k) for _, k in METRICS}
    frozen = work.get('frozenQuality') or {}
    values.update(frozenPsnr=frozen.get('psnrDb'), frozenMae=frozen.get('meanAbsoluteError'))
    motion = work.get('motionQuality') or {}
    if motion.get('valid'):
        summary = motion.get('summary') or {}
        values.update(motionPsnr=summary.get('medianPsnrDb'),
                      motionWorstPsnr=summary.get('worstDecilePsnrDb'),
                      motionMae=summary.get('medianMeanAbsoluteError'),
                      motionPairs=len(motion.get('pairs', [])))
        # Coverage counters are reported only when present; missing is not zero.
        for output, names in [('motionSourceSamples', ['sourceSamples', 'source']),
                              ('motionDecodedSamples', ['decodedSamples', 'decoded'])]:
            for name in names:
                if isinstance(motion.get(name), list):
                    values[output] = len(motion[name])
                    break
    trials = [v for v in latency if finite(v)]
    if trials:
        ordered = sorted(trials)
        values.update(latencyMedian=median(trials), latencyP95=ordered[math.ceil(.95 * len(ordered)) - 1],
                      latencyTrials=len(trials))
    return values


def export(manifest_path, output, root):
    manifest = json.loads(manifest_path.read_text())
    for key in ['title', 'finalImage', 'finalSourceCommit', 'selectedRuns', 'verification', 'limitations', 'notes']:
        if key not in manifest:
            raise ValueError(f'Manifest missing {key}')
    groups = defaultdict(list)
    evidence, failures, identities = [], [], []

    def link_for(path, override=None):
        if override:
            return override
        relative = Path(path)
        if relative.is_absolute():
            relative = relative.relative_to(root)
        return 'evidence/general/' + relative.as_posix()

    for selection in manifest['selectedRuns']:
        source = Path(selection['raw'])
        if not source.is_absolute():
            source = root / source
        raw = json.loads(source.read_text())
        href = link_for(selection['raw'], selection.get('evidenceHref'))
        label, kind = selection['label'], selection['kind']
        evidence.append((label, href))
        profile = selection.get('profile', raw.get('profile', 'game' if 'phases' in raw else 'unspecified'))
        errors = raw.get('errors') or []
        identities.append([label, kind, raw.get('engine', 'unspecified'), profile,
                           raw.get('imageId', raw.get('image', 'unrecorded')),
                           raw.get('runnerSha256', 'unrecorded'), raw.get('fixtureSha256', 'unrecorded')])
        if raw.get('valid') is not True:
            failures.append([label, profile, 'entire run excluded', json.dumps(errors), href])
            continue
        for mode, work in raw.get('runs', raw.get('phases', {})).items():
            if work.get('valid') is False or work.get('errors'):
                failures.append([label, profile + '/' + mode, 'workload excluded', json.dumps(work.get('errors', [])), href])
                continue
            values = extract(work, (raw.get('latency') or {}).get(mode, []))
            text = raw.get('text') or {}
            values.update(originalTextPsnr=text.get('psnrDb'),
                          originalTextInkMae=text.get('textInkMeanAbsoluteError'))
            groups[(profile, mode, label, kind, raw.get('engine', 'unspecified'))].append(values)

    limits = [
        'Only X11/Xfce is validated here. GNOME on X11 is unverified; a Wayland backend is not implemented. Typed SDK, CLI, developer experience and agent experience status come from manifest verification evidence. Rust versus C++ is an implementation choice, not a benchmark result.',
        'Local unauthenticated lab profile; CPU-only 1280×720 capture and Chrome 156. Browser and VM resources are excluded from container CPU/RAM. No deployment or WAN readiness claim.',
        'Network profiles use relay delays and rate limits; they do not establish WAN packet-loss behavior.',
        'Continuous quality is sparsely sampled, exact-marker matched evidence. Matched-pair counts and available coverage counters accompany fidelity; this is not full-rate perceptual equivalence. Resource and quality passes are separate.',
        'Frozen and continuous-motion quality measure different things. Latency and fidelity appear beside resource savings to avoid assuming equal quality.',
        'No held-out workload claim is made unless the manifest explicitly supplies evidence. Selection and reporting can reuse the same workloads.',
        'n counts independent selected runs for each metric. Ranges are observed minima/maxima, not confidence intervals. Missing metrics are unmeasured, never zero.',
        'Game visual-change hashes are not decoded FPS or physical presentation. Game resources include the application and desktop; producer rate and input latency may be unmeasured.',
    ] + manifest['limitations']
    sections = []

    def paragraph(text):
        return '<p>' + html.escape(str(text)) + '</p>'

    def table(headers, rows):
        header = '<tr>' + ''.join('<th scope="col">' + html.escape(str(v)) + '</th>' for v in headers) + '</tr>'
        body = ''.join('<tr>' + ''.join('<td>' + html.escape(str(v)) + '</td>' for v in row) + '</tr>' for row in rows)
        return '<div class="table"><table><thead>' + header + '</thead><tbody>' + body + '</tbody></table></div>'

    def md_table(headers, rows):
        clean = lambda v: str(v).replace('|', '\\|').replace('\n', ' ')
        return '\n'.join(['| ' + ' | '.join(map(clean, headers)) + ' |', '| ' + ' | '.join('---' for _ in headers) + ' |'] +
                         ['| ' + ' | '.join(map(clean, row)) + ' |' for row in rows])

    title = manifest['title']
    summary = f'Selected evidence: {len(manifest["selectedRuns"])} runs; {len(failures)} excluded run/workload observations. Final image: {manifest["finalImage"]}. Source commit: {manifest["finalSourceCommit"]}.'
    md = ['# ' + title, summary, 'This report describes the explicit manifest selection. It does not infer a universal winner or equal motion quality.',
          '[Initial nine-session desktop benchmark](native-stream-report.md) is separate context; its measurements are not pooled here.',
          '## Findings', '\n\n'.join(manifest['notes']) or 'No conclusion supplied.']
    sections.append('<section><h2>Findings</h2>' + ''.join(paragraph(n) for n in manifest['notes']) + '</section>')
    profiles = sorted({g[0] for g in groups})
    for profile in profiles:
        for mode in sorted({g[1] for g in groups if g[0] == profile}):
            selected = [(g, runs) for g, runs in groups.items() if g[:2] == (profile, mode)]
            headers = ['Metric'] + [f'{g[2]} · {g[3]} · {g[4]}' for g, _ in selected]
            rows = [[name] + [format_values([r.get(key) for r in runs]) for _, runs in selected] for name, key in METRICS]
            heading = profile + ' / ' + mode
            md += ['## ' + heading, md_table(headers, rows)]
            sections.append('<section data-profile="' + html.escape(profile, quote=True) + '"><h2>' + html.escape(heading) + '</h2>' + table(headers, rows) + '</section>')
    verification = [[v['name'], v['status'], v.get('evidence', '')] for v in manifest['verification']]
    for heading, headers, rows in [('Verification', ['Check', 'Status', 'Evidence'], verification),
                                   ('Excluded observations', ['Variant', 'Profile/workload', 'Disposition', 'Errors', 'Evidence'], failures),
                                   ('Run provenance', ['Variant', 'Kind', 'Engine', 'Profile', 'Image', 'Runner SHA256', 'Fixture SHA256'], identities)]:
        md += ['## ' + heading, md_table(headers, rows) if rows else 'None recorded.']
        sections.append('<section><h2>' + heading + '</h2>' + (table(headers, rows) if rows else paragraph('None recorded.')) + '</section>')
    for v in manifest['verification']:
        if v.get('evidence'):
            evidence.append((v['name'], link_for(v['evidence'], v.get('evidenceHref'))))
    md += ['## Scope and limits', '\n\n'.join(limits), '## Evidence',
           '\n'.join('- [' + label.replace(']', '') + '](' + href + ')' for label, href in evidence)]
    sections.append('<section><h2>Scope and limits</h2><ul>' + ''.join('<li>' + html.escape(v) + '</li>' for v in limits) + '</ul></section>')
    sections.append('<section><h2>Evidence</h2><ul>' + ''.join('<li><a href="' + html.escape(href, quote=True) + '">' + html.escape(label) + '</a></li>' for label, href in evidence) + '</ul></section>')
    page = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + html.escape(title) + '''</title><style>
    :root{font-family:system-ui,sans-serif;color:#182c35;background:#f4f6f7;line-height:1.55}body{margin:0}main{overflow-wrap:anywhere;max-width:1250px;margin:40px auto;padding:0 20px}h1{font-size:clamp(2rem,5vw,3rem);line-height:1.15}section{background:white;padding:22px;margin:22px 0;border:1px solid #d6dfe2;border-radius:10px}h2{font-size:1.3rem;margin:0 0 12px}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.85rem}th,td{padding:10px;border-bottom:1px solid #dce3e6;text-align:left;min-width:150px;vertical-align:top;overflow-wrap:anywhere}th{background:#edf2f4}a{color:#165b85}select{font:inherit;padding:8px}li{margin:8px 0}.notice{border-left:4px solid #a36920;padding:12px;background:#fff7e8}@media(max-width:600px){main{padding:0 12px;margin:24px auto}section{padding:14px}th,td{min-width:130px}}@media print{body{background:white}section{border:0;padding:0}.table{overflow:visible}select,label[for=profile]{display:none}}
    </style><main><h1>''' + html.escape(title) + '</h1>' + paragraph(summary) + '<p class="notice">Explicit selected evidence. No universal winner or equal-quality conclusion is inferred. Invalid observations are excluded visibly.</p><p><a href="native-stream-report.md">Initial nine-session desktop benchmark</a> is separate context.</p><label for="profile">Filter profile </label><select id="profile"><option value="">All profiles</option>' + ''.join('<option>' + html.escape(p) + '</option>' for p in profiles) + '</select>' + ''.join(sections) + '''</main><script>document.getElementById('profile').addEventListener('change',e=>{document.querySelectorAll('[data-profile]').forEach(s=>s.hidden=!!e.target.value&&s.dataset.profile!==e.target.value)})</script></html>'''
    output.mkdir(parents=True, exist_ok=True)
    (output/'general-engine-report.md').write_text('\n\n'.join(md) + '\n')
    (output/'general-engine-report.html').write_text(page)
    return {'selected': len(manifest['selectedRuns']), 'excluded': len(failures), 'groups': len(groups)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1]/'optimize')
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    print(json.dumps(export(args.manifest, args.output, args.root)))
