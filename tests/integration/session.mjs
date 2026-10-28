import {execFileSync} from 'node:child_process';

/** Reads the running session's display, Xauthority and token from a test container; `x11` holds the docker exec env flags. */
export function session(container) {
  const s = JSON.parse(execFileSync('docker', ['exec', container, 'relay', 'status', '--show-token', '--json'],
    {encoding: 'utf8', timeout: 15000}));
  return {...s, x11: ['-e', `DISPLAY=${s.display}`, '-e', `XAUTHORITY=${s.xauthority}`]};
}
