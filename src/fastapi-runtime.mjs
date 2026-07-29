import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function collectFastApiOpenApi({ codePath, appTarget, runDocker, timeoutMs }) {
  if (!runDocker) {
    runDocker = async (args, { signal }) => {
      // In production, spawn docker CLI
      return new Promise((resolve, reject) => {
        const proc = spawn('docker', args, { signal });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => stdout += d.toString());
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('close', code => {
          resolve({ stdout, stderr, exitCode: code });
        });
        proc.on('error', err => {
          reject(err);
        });
      });
    };
  }

  const scriptPath = path.resolve(__dirname, '../scripts/collect-openapi.py');
  const scriptName = 'collect-openapi.py';

  const dockerArgs = [
    'run',
    '--network=none',
    '--read-only',
    '--tmpfs=/tmp',
    '--cpus=1',
    '--memory=512m',
    '--pids-limit=50',
    '--rm',
    '-v', `${codePath}:/app:ro`,
    '-v', `${scriptPath}:/scripts/${scriptName}:ro`,
    '-w', '/app',
    'python:3.11-slim',
    'python', `/scripts/${scriptName}`, appTarget
  ];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let result;
  try {
    result = await runDocker(dockerArgs, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { openapi: null, diagnostic: { type: 'timeout', message: 'Docker execution timed out' } };
    }
    if (err.code === 'ENOENT') {
      return { openapi: null, diagnostic: { type: 'docker_absence', message: 'Docker is not installed or not in PATH' } };
    }
    return { openapi: null, diagnostic: { type: 'docker_error', message: err.message } };
  }
  clearTimeout(timeoutId);

  if (result.exitCode !== 0) {
    return { 
      openapi: null, 
      diagnostic: { 
        type: 'docker_error', 
        message: `Docker process exited with code ${result.exitCode}` 
      } 
    };
  }

  // Ensure bounded stdout, but here we just parse it. The runner would bounded it in real execution,
  // or we can check length.
  if (result.stdout.length > 10 * 1024 * 1024) {
    return { openapi: null, diagnostic: { type: 'oversized_output', message: 'Output exceeded size limit' } };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    return { openapi: null, diagnostic: { type: 'invalid_json', message: 'Invalid JSON returned from container' } };
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.paths || typeof parsed.paths !== 'object') {
    return { openapi: null, diagnostic: { type: 'invalid_openapi', message: 'Missing paths object in OpenAPI' } };
  }

  return { openapi: parsed, diagnostic: null };
}
