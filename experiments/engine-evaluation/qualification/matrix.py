"""Serialize first breadth observations; retain failures as evidence, never score them as wins."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import time

root = Path(__file__).resolve().parent.parent
out = root / 'qualification/results/breadth-matrix'
out.mkdir(parents=True, exist_ok=True)
jobs = []
for profile, cases in [('local', 'idle,scroll,window,video,mixed'),
                       ('delay', 'scroll'), ('bandwidth', 'scroll,video')]:
    for engine in ('native', 'selkies', 'kasm'):
        jobs.append((f'{profile}-{engine}', ['node', 'qualification/run.mjs'],
                     dict(ENGINE=engine, CASES=cases, NET_PROFILE=profile,
                          MOTION_QUALITY='1' if profile == 'local' else '0')))
for engine in ('selkies', 'kasm'):
    jobs.append((f'game-{engine}', ['node', 'qualification/game.mjs', engine], {}))
result = {'started': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'scope': 'One exploratory breadth observation per engine/profile; not repeated confirmation',
          'runs': []}
for name, command, changes in jobs:
    print(f'START {name}', flush=True)
    start = time.monotonic()
    stdout, stderr = out / f'{name}.stdout', out / f'{name}.stderr'
    with stdout.open('w') as output, stderr.open('w') as errors:
        try:
            status = subprocess.run(command, cwd=root, env={**os.environ, **changes},
                                    stdout=output, stderr=errors, timeout=600).returncode
        except subprocess.TimeoutExpired:
            status = 'timeout'
    entry = dict(name=name, exit_code=status, seconds=time.monotonic()-start,
                 stdout=str(stdout), stderr=str(stderr))
    try:
        entry['receipt'] = json.loads(stdout.read_text().strip().splitlines()[-1])
        assert isinstance(entry['receipt'].get('valid'), bool), 'Missing validity receipt'
    except (ValueError, IndexError, AssertionError) as error:
        entry['receipt_error'] = str(error)
    result['runs'].append(entry)
    (out / 'matrix.json').write_text(json.dumps(result, indent=2)+'\n')
    print(f'END {name} status={status}', flush=True)
    # A timed-out child may have left its container running; never contaminate the next run.
    if status == 'timeout':
        print('STOP: timeout requires parent cleanup before another measurement', flush=True)
        break
result['finished'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
(out / 'matrix.json').write_text(json.dumps(result, indent=2)+'\n')
