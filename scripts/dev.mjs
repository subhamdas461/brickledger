// Runs the API and the web dev server side by side with prefixed output (cross-platform).
import { spawn } from 'node:child_process';

const targets = [
  { name: 'api', workspace: '@brickledger/api', color: '\x1b[36m' },
  { name: 'web', workspace: '@brickledger/web', color: '\x1b[35m' },
];

const children = targets.map(({ name, workspace, color }) => {
  const child = spawn(`npm run dev --workspace ${workspace}`, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`);
    for (const other of children) if (other !== child && other.exitCode === null) other.kill();
    process.exitCode = code ?? 0;
  });
  return child;
});

const stop = () => children.forEach((c) => c.exitCode === null && c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
