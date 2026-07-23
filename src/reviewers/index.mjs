import { createOpenAiCompatibleReviewer } from './openai-compatible.mjs';

export function createReviewer(config, dependencies) {
  if (config.provider === 'openai-compatible') {
    return createOpenAiCompatibleReviewer(config, dependencies);
  }
  throw new Error(`Unsupported reviewer provider: ${config.provider}`);
}
