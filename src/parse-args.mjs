const DEFAULT_PORT = 4317;

export function usage() {
  return `Usage:
  vlp-review --prompt <file> --code <file-or-directory> [--port <number>] [--no-open]

Options:
  --prompt <file>            Original prompt as UTF-8 text or Markdown
  --code <path>              Generated JS/TS file or directory
  --port <number>            Local port (default: ${DEFAULT_PORT})
  --no-open                  Print URL without opening a browser
  -h, --help                 Show this help`;
}

export function parseArgs(argv) {
  const result = {
    promptPath: null,
    codePath: null,
    runtime: null,
    fastapiApp: null,
    port: DEFAULT_PORT,
    open: true,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--help' || option === '-h') {
      result.help = true;
      continue;
    }
    if (option === '--no-open') {
      result.open = false;
      continue;
    }
    if (!['--prompt', '--code', '--port', '--runtime', '--fastapi-app'].includes(option)) {
      throw new Error(`Unknown option: ${option}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${option} requires a value`);
    }
    index += 1;

    if (option === '--prompt') result.promptPath = value;
    if (option === '--code') result.codePath = value;
    if (option === '--runtime') {
      if (value !== 'fastapi') {
        throw new Error('--runtime must be fastapi');
      }
      result.runtime = value;
    }
    if (option === '--fastapi-app') {
      if (!/^[A-Za-z_][\w.]*:[A-Za-z_]\w*$/.test(value)) {
        throw new Error('--fastapi-app must match module:attribute');
      }
      result.fastapiApp = value;
    }
    if (option === '--port') {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('--port must be an integer between 1 and 65535');
      }
      result.port = port;
    }
  }

  if (!result.help && (!result.promptPath || !result.codePath)) {
    throw new Error('Both --prompt and --code are required');
  }

  if (result.runtime === 'fastapi' && !result.fastapiApp) {
    throw new Error('Requires --fastapi-app when using --runtime fastapi');
  }
  if (result.fastapiApp && result.runtime !== 'fastapi') {
    throw new Error('Requires --runtime fastapi when using --fastapi-app');
  }

  return result;
}
