# Agent Reviewer Mode Design

## Summary

Extend VLP Review with an agent-first validation mode. Instead of requiring a person to answer every targeted VLP question, a configured reviewer agent returns structured decisions, confidence, rationale, and intent provenance. A deterministic local policy accepts sufficiently grounded decisions and escalates uncertain or invented intent to a person.

The reviewer generates approval evidence and repair instructions but never modifies project files. The existing manual workflow remains available when no reviewer provider is configured, preserving backward compatibility.

## Repository and Branch

- Repository: `https://github.com/arexgill/vlp-review`
- Base branch: `main` (the repository has no `master` branch)
- Feature branch: `feature/agent-reviewer`

## Goals

- Let another agent review and approve clear VLP questions without human confirmation.
- Escalate uncertain decisions through predictable local rules rather than model discretion alone.
- Preserve an audit trail showing which agent, model, evidence, rationale, and confidence produced each decision.
- Keep reviewer providers replaceable through a small interface.
- Provide OpenAI-compatible chat completions as the first built-in provider.
- Support both unattended CLI review and an explicit browser Run/Re-run action.
- Keep repair separate from review: produce instructions, never patches.

## Non-Goals

- Automatically modifying source files.
- Allowing the reviewer model to execute code, shell commands, tools, or tests.
- Replacing the deterministic local mismatch detector.
- Supporting Anthropic or local subprocess adapters in this iteration.
- Persisting reviews across CLI process restarts on the server.
- Guaranteeing correctness or reproducing the paper's formal verification layer.
- Sending the complete project to the reviewer endpoint.

## Modes

### Manual mode

When `--reviewer` is absent, VLP Review behaves as it does on `main`: the browser presents targeted questions for a person to answer.

### Agent mode

When `--reviewer openai-compatible` is present, the server configures an agent reviewer. The UI presents agent controls and audit data. Questions accepted by policy are read-only. Questions escalated by policy retain the human response controls.

`--auto-review` starts one agent review before opening the browser. Without `--auto-review`, the browser starts in a ready state and waits for **Run agent review**.

## CLI Configuration

Example:

```bash
export VLP_REVIEWER_API_KEY='...'

vlp-review \
  --prompt prompt.md \
  --code src \
  --reviewer openai-compatible \
  --reviewer-model gpt-4.1-mini \
  --reviewer-base-url https://api.openai.com/v1 \
  --auto-review
```

New options:

- `--reviewer openai-compatible` selects the first built-in provider.
- `--reviewer-model <model-id>` is required when a reviewer is configured.
- `--reviewer-base-url <url>` defaults to `https://api.openai.com/v1`.
- `--auto-review` requires a configured reviewer.

Credential:

- `VLP_REVIEWER_API_KEY` is required for agent review.
- API keys are never accepted as CLI flags, preventing shell-history leakage.
- The key is retained only in server memory and never included in session JSON, reports, browser responses, or logs.

The base URL must use HTTPS. Plain HTTP is allowed only when the hostname is exactly `localhost`, `127.0.0.1`, or `::1`, enabling fake/local providers.

## Provider Boundary

A provider implements:

```js
{
  id: 'openai-compatible',
  review(input, options): Promise<ProviderReview>
}
```

`input` contains:

```js
{
  sessionId: string,
  prompt: string,
  questions: Array<{
    id: string,
    type: string,
    severity: string,
    ask: string,
    reason: string,
    promptEvidence: string,
    evidence: Array<{
      docUnitId: string,
      file: string,
      lineStart: number,
      documentation: string,
      code: string
    }>
  }>
}
```

Only linked evidence is sent. Complete source files and unrelated documentation units are excluded.

`options` contains an `AbortSignal`; the adapter must stop network work when the configured timeout expires.

The provider returns untrusted JSON shaped as:

```js
{
  summary: string,
  decisions: Array<{
    questionId: string,
    decision: 'accept' | 'correct' | 'irrelevant' | 'escalate',
    answer: string,
    rationale: string,
    confidence: number,
    intentBasis: 'explicit-prompt' | 'inferred' | 'absent',
    evidenceDocUnitIds: string[]
  }>
}
```

Provider parsing produces two collections: valid decisions and validation issues. Unknown question IDs, duplicate decisions, out-of-range confidence, unknown evidence IDs, invalid enums, and oversized text never enter the valid collection. A duplicate question ID invalidates every returned entry for that question so response ordering cannot decide which answer wins.

## OpenAI-Compatible Adapter

The first adapter calls:

```text
POST <reviewer-base-url>/chat/completions
Authorization: Bearer <VLP_REVIEWER_API_KEY>
Content-Type: application/json
```

The request uses:

- the configured model;
- temperature `0`;
- system instructions defining the reviewer role and JSON schema;
- one user message containing the targeted review input;
- `response_format: { "type": "json_object" }`.

The adapter reads `choices[0].message.content`, parses it as JSON, and validates it. A response body is capped at 1 MiB. The request times out after 60 seconds.

If JSON parsing fails or any validation issue exists, the adapter retries once with a repair instruction containing the validation errors and the original response. After that retry, valid decisions are retained and invalid or missing questions are escalated. If the second response cannot be parsed as JSON at all, every question is escalated with an `invalid-provider-output` reason; this is a **Needs human review** result, not a provider failure. Network errors, authentication errors, rate limits, oversized HTTP responses, and timeouts are not automatically retried; they produce a **Reviewer failed** state with a safe user-facing message.

## Deterministic Escalation Policy

The local policy threshold is `0.80` and is not controlled by the model.

A question is escalated when any condition is true:

1. The provider explicitly returns `decision: "escalate"`.
2. The provider omits the question or returns an invalid decision for it after the one repair attempt.
3. `confidence < 0.80`.
4. The decision is `accept` or `correct` and `intentBasis` is not `explicit-prompt`.
5. A correction has an empty answer.

Otherwise, the agent decision is approved by policy.

Policy output per question:

```js
{
  questionId: string,
  status: 'approved' | 'escalated',
  proposedDecision: 'accept' | 'correct' | 'irrelevant' | 'escalate',
  effectiveDecision: 'accept' | 'correct' | 'irrelevant' | null,
  confidence: number | null,
  rationale: string,
  answer: string,
  intentBasis: 'explicit-prompt' | 'inferred' | 'absent' | null,
  evidenceDocUnitIds: string[],
  escalationReasons: string[]
}
```

An agent review is **Agent approved** only when every targeted question is approved. If at least one question is escalated, the agent review is **Needs human review**. A provider/configuration/network failure is **Reviewer failed** and contains no approval claim. After every escalation receives a human response, the report's final validation status becomes **Completed with human resolution**; it never relabels that outcome as agent-approved.

When the session has zero targeted questions, agent mode records **Agent approved: no targeted mismatches**, while retaining the existing warning that heuristic silence is not proof of correctness.

## Review Orchestration and State

`AgentReviewService` owns one in-memory state object:

```js
{
  status: 'not-configured' | 'ready' | 'running' | 'approved' | 'needs-human' | 'failed',
  provider: string | null,
  model: string | null,
  threshold: 0.8,
  startedAt: string | null,
  completedAt: string | null,
  summary: string,
  results: AgentPolicyResult[],
  error: { code: string, message: string } | null
}
```

The service exposes `getState()` and `run()`. If `run()` is called while a review is running, it returns the existing in-flight promise. A successful re-run atomically replaces the previous agent results; callers never observe a partially replaced result set.

Timestamps are supplied by an injectable clock so tests remain deterministic.

## HTTP API

Existing endpoints remain:

- `GET /api/session`
- `POST /api/report`

New endpoint:

- `GET /api/agent-review` returns sanitized review state.
- `POST /api/agent-review` starts or re-runs review and returns the resulting sanitized state.
- Other methods return `405`.

The sanitized state includes provider ID and model but no provider URL, request headers, raw provider response, system prompt, or credentials.

`POST /api/report` continues accepting `{ responses }`. In agent mode, those responses may answer only escalated questions. Agent-approved results come from server review state and cannot be forged or replaced by browser input.

## Browser Experience

When agent mode is configured, the review panel adds:

- reviewer provider/model badge;
- remote-review disclosure;
- **Run agent review** or **Re-run agent review** button;
- running progress/status;
- agent review result: Agent approved, Needs human review, or Reviewer failed; once escalations are answered, the report separately shows Completed with human resolution.

Each question displays:

- proposed/effective decision;
- confidence percentage;
- rationale;
- intent basis;
- agent-cited evidence;
- escalation reasons when present.

Agent-approved questions are read-only. Escalated questions retain **Accept behavior**, **Correct intent**, and **Not relevant** controls. Human answers are stored in the existing session-scoped `localStorage` key.

In manual mode, the current UI and behavior remain unchanged.

## Report and Approval Audit

The report generator receives the server-owned agent review state in addition to human escalation responses.

Agent-mode report header:

```text
Reviewer: openai-compatible / <model-id>
Agent review status: Agent approved | Needs human review | Reviewer failed
Final validation status: Agent approved | Completed with human resolution | Needs human review | Reviewer failed
Policy threshold: 0.80
Approved automatically: <count>
Escalated: <count>
```

Each reviewed question records:

- agent proposal;
- policy status;
- confidence;
- intent basis;
- rationale;
- trace evidence;
- escalation reasons;
- human resolution, only when escalated and answered.

Only effective `correct` decisions become repair instructions. Approved `accept` decisions become preservation instructions. Escalated but unanswered questions remain unresolved and prevent an “Agent approved” claim.

## Error Handling

- Missing `--reviewer-model`: CLI exits non-zero with setup guidance.
- `--auto-review` without `--reviewer`: CLI exits non-zero.
- Missing API key: server starts, reviewer state is `failed`/configuration error, and the UI shows the required environment variable without exposing values.
- Invalid base URL: CLI exits non-zero.
- Provider timeout/network/auth/rate-limit failure: state becomes `failed`; the UI offers retry.
- Malformed/invalid output: one repair attempt; remaining invalid/missing questions escalate.
- Concurrent run requests: one provider operation, shared by all callers.
- Report requested while review is `running`: HTTP `409`.
- Agent mode report requested before a review: report states that agent review has not run and does not claim approval.

## Security and Privacy

- Agent mode changes the original local-only privacy boundary; the UI and README must state this prominently.
- Data sent remotely is limited to the full original prompt plus targeted questions and their linked excerpts.
- Generated source is never executed.
- Provider output is never rendered as HTML; browser rendering uses text nodes.
- Provider errors shown to users exclude headers, request bodies, tokens, and raw upstream responses.
- API keys are excluded from session fingerprints, logs, report content, and test snapshots.
- The server continues binding only to `127.0.0.1`.

## Testing

Automated tests cover:

- CLI option compatibility and invalid combinations.
- Base URL validation and key redaction.
- Provider registry selection and unknown-provider errors.
- OpenAI-compatible request shape using a fake localhost server.
- Valid output, malformed output repair, timeout, auth failure, oversized output, and schema failures.
- Policy threshold boundary (`0.79` escalates, `0.80` passes).
- Inferred/absent intent escalation.
- Missing and duplicate question handling.
- In-flight request deduplication and atomic replacement on re-run.
- Agent-review HTTP GET/POST/405 behavior.
- Report rejection while running and server-owned agent decisions.
- Agent provenance, approval status, repair instructions, and unresolved escalations in Markdown.
- UI contracts for ready, running, approved, escalated, and failed states.
- Auto-review CLI startup against a fake provider.
- Existing manual-mode tests and behavior.

No test calls a real model API.

## Acceptance Criteria

1. A user can configure an OpenAI-compatible reviewer without exposing its key to the browser.
2. Clicking **Run agent review** produces structured decisions and policy results for every targeted question.
3. `--auto-review` completes the same workflow before opening the browser.
4. Confidence below `0.80`, invalid output, missing decisions, and non-explicit accept/correct intent are escalated.
5. Agent-approved questions cannot be overwritten through the browser report request.
6. Escalated questions can be resolved manually and remain visibly attributed to the person.
7. The final report accurately distinguishes agent approval, completed human resolution, still-required human review, and reviewer failure.
8. The reviewer never modifies source files.
9. Manual mode remains functional when no reviewer is configured.
10. All automated tests pass without contacting a real reviewer endpoint.
