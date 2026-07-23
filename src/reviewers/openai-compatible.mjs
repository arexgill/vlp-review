import { validateReviewContent } from '../review-contract.mjs';

const RESPONSE_LIMIT = 1024 * 1024;

export class ReviewerProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReviewerProviderError';
    this.code = code;
  }
}

function providerError(code, message) {
  return new ReviewerProviderError(code, message);
}

function initialMessages(input) {
  return [{
    role: 'system',
    content: [
      'Return only a complete JSON object with this exact shape:',
      '{',
      '  "summary": string,',
      '  "decisions": [',
      '    {',
      '      "questionId": string,',
      '      "decision": "accept" | "correct" | "irrelevant" | "escalate",',
      '      "answer": string,',
      '      "rationale": string,',
      '      "confidence": number,',
      '      "intentBasis": "explicit-prompt" | "inferred" | "absent",',
      '      "evidenceDocUnitIds": string[]',
      '    }',
      '  ]',
      '}',
      'Do not execute code, call tools, or add markdown fences.'
    ].join('\n')
  }, {
    role: 'user',
    content: JSON.stringify(input)
  }];
}

function repairMessages(messages, content, issues) {
  return [...messages, {
    role: 'assistant',
    content
  }, {
    role: 'user',
    content: [
      'Return a complete corrected JSON object.',
      ...issues.map(({ code, message }) => `- ${code}: ${message}`)
    ].join('\n')
  }];
}

async function readBoundedText(response) {
  if (!response.body) {
    return '';
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > RESPONSE_LIMIT) {
        await reader.cancel();
        throw providerError('response-too-large', 'Reviewer response exceeded 1048576 bytes.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return chunks.map(chunk => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();
}

function parseContent(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw providerError('invalid-provider-envelope', 'Reviewer returned an invalid response envelope.');
  }

  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw providerError('invalid-provider-envelope', 'Reviewer returned an invalid response envelope.');
  }
  return content;
}

function isAbortError(error, signal) {
  return Boolean(signal?.aborted) || error?.name === 'AbortError' || error?.name === 'TimeoutError';
}

async function requestCompletion(baseUrl, apiKey, model, fetchImpl, messages, signal) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages
      }),
      signal
    });
  } catch (error) {
    if (isAbortError(error, signal)) {
      throw providerError('review-timeout', 'Reviewer request timed out.');
    }
    throw error;
  }

  if (response.status === 401 || response.status === 403) {
    throw providerError('authentication-failed', 'Reviewer authentication failed.');
  }
  if (response.status === 429) {
    throw providerError('rate-limited', 'Reviewer rate limit exceeded.');
  }
  if (!response.ok) {
    throw providerError('provider-http-error', `Reviewer request failed with HTTP ${response.status}.`);
  }

  const body = await readBoundedText(response);
  return parseContent(body);
}

export function createOpenAiCompatibleReviewer(
  config,
  { fetchImpl = globalThis.fetch } = {}
) {
  const messagesFor = input => initialMessages(input);

  async function review(input, { signal } = {}) {
    const messages = messagesFor(input);
    const content = await requestCompletion(config.baseUrl, config.apiKey, config.model, fetchImpl, messages, signal);
    const result = validateReviewContent(content, input);
    if (!result.issues.length) {
      return result;
    }

    const repairedContent = await requestCompletion(
      config.baseUrl,
      config.apiKey,
      config.model,
      fetchImpl,
      repairMessages(messages, content, result.issues),
      signal
    );
    return validateReviewContent(repairedContent, input);
  }

  return Object.freeze({
    id: 'openai-compatible',
    model: config.model,
    review
  });
}
