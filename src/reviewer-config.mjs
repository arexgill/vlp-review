export const DEFAULT_REVIEWER_BASE_URL = 'https://api.openai.com/v1';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

export function normalizeReviewerBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error('Reviewer base URL must be a valid HTTP or HTTPS URL');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  const loopbackHttp = url.protocol === 'http:' && LOOPBACK.has(hostname);
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new Error('Reviewer base URL must use HTTPS unless it targets exact loopback');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Reviewer base URL cannot contain credentials, query parameters, or fragments');
  }
  return url.toString().replace(/\/$/, '');
}

export function createReviewerConfig(options, env = process.env) {
  if (!options.reviewer) return null;
  return {
    provider: options.reviewer,
    model: options.reviewerModel,
    baseUrl: normalizeReviewerBaseUrl(options.reviewerBaseUrl),
    apiKey: String(env.VLP_REVIEWER_API_KEY || '').trim() || null
  };
}
