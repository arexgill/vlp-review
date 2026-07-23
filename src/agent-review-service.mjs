import { createReviewInput } from './review-contract.mjs';
import { applyReviewPolicy, REVIEW_THRESHOLD } from './review-policy.mjs';

const FAILED_REVIEW_MESSAGE = 'Reviewer request failed. Check provider configuration and retry.';
const NO_QUESTIONS_SUMMARY = 'No targeted mismatches were available for agent review.';

function cloneState(state) {
  return structuredClone(state);
}

function baseState(reviewerInfo) {
  return {
    status: reviewerInfo ? 'ready' : 'not-configured',
    provider: reviewerInfo?.provider || null,
    model: reviewerInfo?.model || null,
    threshold: REVIEW_THRESHOLD,
    startedAt: null,
    completedAt: null,
    summary: '',
    results: [],
    error: null
  };
}

function configurationState(reviewerInfo, configurationError) {
  return {
    ...baseState(reviewerInfo),
    status: 'failed',
    error: {
      code: 'reviewer-configuration',
      message: String(configurationError)
    }
  };
}

export function createAgentReviewService({
  session,
  reviewer = null,
  reviewerInfo = null,
  configurationError = null,
  clock = () => new Date().toISOString(),
  timeoutMs = 60_000
}) {
  let state = configurationError
    ? configurationState(reviewerInfo, configurationError)
    : baseState(reviewerInfo);
  let inFlight = null;

  function getState() {
    return cloneState(state);
  }

  function setInFlight(promise) {
    const wrapped = promise.finally(() => {
      if (inFlight === wrapped) {
        inFlight = null;
      }
    });
    inFlight = wrapped;
    return wrapped;
  }

  function run() {
    if (inFlight) {
      return inFlight;
    }

    if (configurationError) {
      return setInFlight(Promise.resolve().then(() => getState()));
    }

    if (!reviewer) {
      const error = new Error('Reviewer is not configured.');
      error.code = 'reviewer-not-configured';
      return setInFlight(Promise.resolve().then(() => {
        throw error;
      }));
    }

    state = {
      ...state,
      status: 'running',
      startedAt: clock(),
      error: null
    };

    const questions = session?.questions || [];
    if (questions.length === 0) {
      state = {
        ...state,
        status: 'approved',
        completedAt: clock(),
        summary: NO_QUESTIONS_SUMMARY,
        results: [],
        error: null
      };
      return setInFlight(Promise.resolve().then(() => getState()));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let reviewPromise;
    try {
      reviewPromise = reviewer.review(createReviewInput(session), { signal: controller.signal });
    } catch (error) {
      reviewPromise = Promise.reject(error);
    }

    return setInFlight(
      Promise.resolve(reviewPromise)
        .then(providerReview => {
          const results = applyReviewPolicy(session, providerReview);
          state = {
            ...state,
            status: results.every(result => result.status === 'approved') ? 'approved' : 'needs-human',
            completedAt: clock(),
            summary: providerReview?.summary || '',
            results,
            error: null
          };
          return getState();
        })
        .catch(error => {
          state = {
            ...state,
            status: 'failed',
            completedAt: clock(),
            summary: '',
            results: [],
            error: {
              code: error?.code || (controller.signal.aborted ? 'review-timeout' : 'reviewer-request-failed'),
              message: FAILED_REVIEW_MESSAGE
            }
          };
          return getState();
        })
        .finally(() => {
          clearTimeout(timeout);
        })
    );
  }

  return {
    getState,
    run
  };
}
