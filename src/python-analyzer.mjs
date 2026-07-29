import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function extractFastApiContracts(input) {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, '..', 'scripts', 'extract-fastapi.py');
    const child = spawn('python3', [pythonScript]);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python script exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (err) {
        reject(new Error(`Failed to parse Python script output: ${err.message}`));
      }
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}
