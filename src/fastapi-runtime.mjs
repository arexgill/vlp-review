import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function collectFastApiOpenApi({ codePath, appTarget, runDocker, timeoutMs }) {
  if (!runDocker) {
    runDocker = async (args, { signal, input } = {}) => {
      // In production, spawn docker CLI
      return new Promise((resolve, reject) => {
        const proc = spawn('docker', args, { signal });
        let stdout = '';
        let stderr = '';
        let stdoutBytes = 0;
        let stderrBytes = 0;
        const MAX_BYTES = 10 * 1024 * 1024;
        let overflow = false;

        const onData = (d, isStdout) => {
          if (overflow) return;
          if (isStdout) stdoutBytes += d.length;
          else stderrBytes += d.length;

          if (stdoutBytes > MAX_BYTES || stderrBytes > MAX_BYTES) {
            overflow = true;
            proc.kill('SIGKILL');
            return resolve({ stdout: '', stderr: '', exitCode: 1, overflow: true });
          }

          if (isStdout) stdout += d.toString();
          else stderr += d.toString();
        };

        proc.stdout.on('data', d => onData(d, true));
        proc.stderr.on('data', d => onData(d, false));

        if (input) {
          proc.stdin.write(input);
          proc.stdin.end();
        }

        proc.on('close', code => {
          if (!overflow) {
            resolve({ stdout, stderr, exitCode: code });
          }
        });
        proc.on('error', err => {
          reject(err);
        });
      });
    };
  }

  const scriptPath = path.resolve(__dirname, '../scripts/collect-openapi.py');
  const scriptName = 'collect-openapi.py';

  let requirements;
  try {
    requirements = await fs.promises.readFile(path.join(codePath, 'requirements.txt'), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { openapi: null, diagnostic: { type: 'missing_manifest', message: 'No requirements.txt found' } };
    }
    return { openapi: null, diagnostic: { type: 'docker_error', message: err.message } };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // The build phase requires network access to acquire dependencies from PyPI.
  // It receives strictly bounded input (requirements.txt content via stdin) and
  // executes in a disposable container without project source mounts, host credentials,
  // or build secrets. The subsequent runtime container is network-disabled.
  const dockerfile = `FROM python:3.11-slim
WORKDIR /deps
RUN echo "${Buffer.from(requirements).toString('base64')}" | base64 -d > requirements.txt
RUN pip install --no-cache-dir -r requirements.txt -t /deps
`;

  let buildResult;
  try {
    buildResult = await runDocker(['build', '-q', '-'], { signal: controller.signal, input: dockerfile });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') return { openapi: null, diagnostic: { type: 'timeout', message: 'Docker execution timed out' } };
    if (err.code === 'ENOENT') return { openapi: null, diagnostic: { type: 'docker_absence', message: 'Docker is not installed or not in PATH' } };
    return { openapi: null, diagnostic: { type: 'docker_error', message: 'Sandbox build rejected dependencies' } };
  }

  if (buildResult.overflow) {
    clearTimeout(timeoutId);
    return { openapi: null, diagnostic: { type: 'oversized_output', message: 'Build output exceeded size limit' } };
  }

  if (buildResult.exitCode !== 0) {
    clearTimeout(timeoutId);
    return { openapi: null, diagnostic: { type: 'build_error', message: 'Sandbox build rejected dependencies' } };
  }

  const imageId = buildResult.stdout.trim();

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
    '-e', 'PYTHONPATH=/deps',
    imageId,
    'python', `/scripts/${scriptName}`, appTarget
  ];

  let result;
  try {
    result = await runDocker(dockerArgs, { signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      return { openapi: null, diagnostic: { type: 'timeout', message: 'Docker execution timed out' } };
    }
    if (err.code === 'ENOENT') {
      return { openapi: null, diagnostic: { type: 'docker_absence', message: 'Docker is not installed or not in PATH' } };
    }
    return { openapi: null, diagnostic: { type: 'docker_error', message: 'Docker subprocess failed' } };
  } finally {
    clearTimeout(timeoutId);
    runDocker(['rmi', '-f', imageId], { signal: AbortSignal.timeout(5000) }).catch(() => {});
  }

  if (result.overflow) {
    return { openapi: null, diagnostic: { type: 'oversized_output', message: 'Output exceeded size limit' } };
  }

  if (result.exitCode !== 0) {
    return {
      openapi: null,
      diagnostic: {
        type: 'docker_error',
        message: `Docker process exited with code ${result.exitCode}`
      }
    };
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

  const sanitized = { paths: {} };
  for (const [pathKey, pathObj] of Object.entries(parsed.paths)) {
    if (!pathObj || typeof pathObj !== 'object') continue;
    sanitized.paths[pathKey] = {};
    for (const [method, opObj] of Object.entries(pathObj)) {
      if (!opObj || typeof opObj !== 'object') continue;
      const sanitizedOp = { responses: {} };
      if (opObj.responses && typeof opObj.responses === 'object') {
        for (const [status, respObj] of Object.entries(opObj.responses)) {
          sanitizedOp.responses[status] = {};
          if (respObj && respObj.content && respObj.content['application/json'] && respObj.content['application/json'].schema) {
            const schema = respObj.content['application/json'].schema;
            const ref = schema.$ref || (schema.items && schema.items.$ref);
            if (ref) {
              sanitizedOp.responses[status] = { schemaRef: ref };
            }
          }
        }
      }
      sanitized.paths[pathKey][method] = sanitizedOp;
    }
  }

  return { openapi: sanitized, diagnostic: null };
}
