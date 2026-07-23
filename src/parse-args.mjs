import {
  DEFAULT_REVIEWER_BASE_URL,
  normalizeReviewerBaseUrl
} from './reviewer-config.mjs';

const DEFAULT_PORT = 4317;

export function usage() {
  return `Usage:
  vlp-review --prompt <file> --code <file-or-directory> [--port <number>] [--no-open]

Options:
  --prompt <file>            Original prompt as UTF-8 text or Markdown
  --code <path>              Generated JS/TS file or directory
  --port <number>            Local port (default: ${DEFAULT_PORT})
  --reviewer <provider>      Enable reviewer configuration
  --reviewer-model <model>   Reviewer model name
  --reviewer-base-url <url>  Reviewer API base URL (default: ${DEFAULT_REVIEWER_BASE_URL})
  --auto-review              Enable automatic reviewer flow
  --no-open                  Print URL without opening a browser
  -h, --help                 Show this help

Environment:
  VLP_REVIEWER_API_KEY       Reviewer API key used when --reviewer is set`;
}

export function parseArgs(argv) {
  const result = {
    promptPath: null,
    codePath: null,
    port: DEFAULT_PORT,
    open: true,
    help: false,
    reviewer: null,
    reviewerModel: null,
    reviewerBaseUrl: DEFAULT_REVIEWER_BASE_URL,
    autoReview: false
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
    if (option === '--auto-review') {
      result.autoReview = true;
      continue;
    }
    if (!['--prompt', '--code', '--port', '--reviewer', '--reviewer-model', '--reviewer-base-url'].includes(option)) {
      throw new Error(`Unknown option: ${option}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${option} requires a value`);
    }
    index += 1;

    if (option === '--prompt') result.promptPath = value;
    if (option === '--code') result.codePath = value;
    if (option === '--port') {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('--port must be an integer between 1 and 65535');
      }
      result.port = port;
    }
    if (option === '--reviewer') result.reviewer = value;
    if (option === '--reviewer-model') result.reviewerModel = value;
    if (option === '--reviewer-base-url') result.reviewerBaseUrl = normalizeReviewerBaseUrl(value);
  }

  if (!result.help) {
    if (!result.promptPath || !result.codePath) {
      throw new Error('Both --prompt and --code are required');
    }
    if (result.reviewer && result.reviewer !== 'openai-compatible') {
      throw new Error(`Unsupported reviewer: ${result.reviewer}`);
    }
    if (result.reviewer && !result.reviewerModel) {
      throw new Error('--reviewer-model is required when --reviewer is configured');
    }
    if (!result.reviewer && result.reviewerModel) {
      throw new Error('--reviewer-model requires --reviewer');
    }
    if (!result.reviewer && result.reviewerBaseUrl !== DEFAULT_REVIEWER_BASE_URL) {
      throw new Error('--reviewer-base-url requires --reviewer');
    }
    if (result.autoReview && !result.reviewer) {
      throw new Error('--auto-review requires --reviewer');
    }
  }

  return result;
}
