export const DEFAULT_REVIEWER_BASE_URL = 'https://api.openai.com/v1';

function exactHttpLoopbackLiteral(value) {
  const match = /^http:\/\/([^/?#]*)/i.exec(value);
  if (!match) return false;

  const authority = match[1];
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (!hostPort) return false;

  const hostname = hostPort.startsWith('[')
    ? hostPort.slice(0, hostPort.indexOf(']') + 1)
    : hostPort.split(':', 1)[0];

  return hostname.toLowerCase() === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function normalizeReviewerBaseUrl(value) {
  const rawValue = String(value);
  if (rawValue !== rawValue.trim()) {
    throw new Error('Reviewer base URL must be a valid HTTP or HTTPS URL');
  }

  let url;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error('Reviewer base URL must be a valid HTTP or HTTPS URL');
  }

  const loopbackHttp = url.protocol === 'http:' && exactHttpLoopbackLiteral(rawValue);
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
