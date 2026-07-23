# VLP Review POC

A VLP-inspired npm CLI for human and agent review of vibe-coded JavaScript and TypeScript.

VLP Review reads the original prompt and generated source, creates syntax-directed “literate” documentation, prioritizes suspicious intent/implementation mismatches, and opens an interactive browser review. Manual mode is local-only and the default. Explicit remote agent mode can send the full prompt plus question-linked documentation/code excerpts to a configured reviewer endpoint. In both modes, the output is a repair-ready Markdown brief for a coding agent; VLP Review never edits reviewed source files.

> This is a local proof of concept, not a correctness oracle. Every flag is a question for human judgment—not proof of a defect.

## Quick start

Requires Node.js 20 or newer.

```bash
git clone git@github.com:arexgill/vlp-review.git
cd vlp-review
npm install
npm test
node bin/vlp-review.mjs \
  --prompt examples/product-search/prompt.md \
  --code examples/product-search/generated-code.js
```

The CLI prints and opens a URL such as `http://127.0.0.1:4317`.

To use the command globally during local POC development:

```bash
npm link
vlp-review --prompt /path/to/prompt.md --code /path/to/project/src
```

To remove the development link:

```bash
npm unlink --global vlp-review-poc
```

## Remote agent mode

Remote agent review is explicit opt-in. Manual review remains the default and stays local-only.

```bash
export VLP_REVIEWER_API_KEY='your-provider-key'
node bin/vlp-review.mjs \
  --prompt examples/product-search/prompt.md \
  --code examples/product-search/generated-code.js \
  --reviewer openai-compatible \
  --reviewer-model '<provider-model-id>' \
  --auto-review
```

Agent mode operational facts:

- `--reviewer`, `--reviewer-model`, `--reviewer-base-url`, and `--auto-review` are the remote-review flags.
- `VLP_REVIEWER_API_KEY` is read only from the environment; there is no CLI flag for credentials.
- Agent mode sends the full prompt plus only the targeted linked excerpts for each question to the configured endpoint.
- Approved agent decisions require confidence `0.80` or higher and `explicit-prompt` grounding; anything else is escalated for human review.
- Reviewer output creates report/repair instructions but never changes files.
- The provider must support OpenAI-compatible `/chat/completions` requests and JSON-object responses.
- Custom `http://` reviewer endpoints are accepted only for exact loopback hosts such as `127.0.0.1`, `localhost`, or `::1`; other endpoints must use HTTPS.
- Automated tests use fake/local reviewer endpoints only. They do not make real model calls.
- This remains a review aid, not a correctness guarantee.

## CLI

```text
vlp-review --prompt <file> --code <file-or-directory> [--port <number>] [--reviewer <provider> --reviewer-model <model> [--reviewer-base-url <url>] [--auto-review]] [--no-open]
```

| Option | Meaning |
| --- | --- |
| `--prompt <file>` | Required UTF-8 text or Markdown prompt. |
| `--code <path>` | Required generated source file or directory. |
| `--port <number>` | Local port from 1–65535. Default: `4317`. |
| `--reviewer <provider>` | Enable explicit remote agent mode. Currently supports `openai-compatible`. |
| `--reviewer-model <model>` | Required reviewer model identifier when `--reviewer` is set. |
| `--reviewer-base-url <url>` | Optional reviewer API base URL. Defaults to `https://api.openai.com/v1`; custom `http://` URLs must be loopback-only. |
| `--auto-review` | Run the configured remote reviewer before the browser session opens. |
| `--no-open` | Start the server without opening a browser. |
| `-h`, `--help` | Print usage. |

| Environment | Meaning |
| --- | --- |
| `VLP_REVIEWER_API_KEY` | Reviewer credential for explicit remote agent mode. Required by the configured provider, but only read from the environment. |

When `--code` points to a directory, discovery is recursive and deterministic.

## Interactive review

The browser session contains:

1. **Original prompt** — the user intent supplied to the coding agent.
2. **Generated code** — a file-selectable, line-numbered source viewer.
3. **Literate documentation** — conservative statements derived from syntax, including signatures, conditions, calls, returns, throws, and catches.
4. **Targeted questions** — suspected missing behavior, unstated values, redundant operations, subjective requirements, and missing error paths.
5. **Repair brief** — Markdown that records accepted behavior, corrected intent, irrelevant items, unresolved questions, parse diagnostics, and agent instructions.

For each question, choose:

- **Accept behavior** — the generated behavior is intentional.
- **Correct intent** — enter the behavior the code should implement.
- **Not relevant** — exclude the question from repair instructions.

Responses persist in browser `localStorage` under the session fingerprint, so a refresh does not discard the review. The final brief can be copied or downloaded. In remote agent mode, agent-approved items are read-only until an escalated item requires human resolution.

## Privacy and security boundaries

- The CLI HTTP server always binds only to `127.0.0.1`.
- Manual mode is the default and remains local-only: prompt, source, documentation, and review responses stay on this machine.
- Explicit remote agent mode sends the full prompt plus question-linked documentation/code excerpts to the configured reviewer endpoint. It does not ship the entire reviewed source tree unless those excerpts are linked into questions.
- `VLP_REVIEWER_API_KEY` is only consulted when remote agent mode is explicitly configured.
- Source is parsed as text and is never imported, executed, or evaluated.
- Static serving uses an allowlist; project files cannot be fetched through the browser server.
- API request bodies are limited to 256 KiB.
- Responses use a restrictive Content Security Policy and `no-store` caching.
- Reviewer suggestions can approve or escalate questions and feed the generated repair brief, but they do not modify files.
- There is no correctness guarantee: both the local heuristics and any configured remote reviewer can be wrong.

You can confirm the browser boundary in developer tools: browser traffic should stay on the current `127.0.0.1` origin. In remote agent mode, only the local CLI server should contact the configured reviewer endpoint.

## Supported source

Supported extensions:

```text
.js .mjs .cjs .jsx .ts .tsx
```

Ignored directories:

```text
.git node_modules dist build coverage
```

Limits:

- 200 discovered source files per session.
- 1 MiB per source file.
- 20 prioritized questions per session.
- 4,000 characters per review response.

A parse failure does not remove the file from the source viewer. It appears under **Parse diagnostics**, and analysis continues for other files.

## What the heuristics look for

The local detector compares meaningful prompt terms with documented behavior and checks for:

- requirements weakly represented in documentation;
- concrete numeric/string values absent from the prompt;
- invalid/error requirements without an explicit throw/catch path;
- return or call behavior with no meaningful prompt trace;
- subjective requirements without measurable criteria.

It includes simple semantic aliases—for example, `toLowerCase()` is evidence for case-insensitive matching and `!query` is evidence for an empty/absent query. These aliases reduce obvious false positives but do not provide full semantic understanding.

Expect both false positives and false negatives. In particular, the POC cannot reliably reason about behavior distributed across repositories, runtime framework conventions, domain knowledge, hidden tests, or semantics not visible in the prompt and AST.

## Architecture

```text
bin/vlp-review.mjs
  ├─ src/load-input.mjs
  ├─ src/analyze-source.mjs       (@babel/parser)
  ├─ src/detect-mismatches.mjs
  ├─ src/create-session.mjs
  ├─ src/server.mjs               (localhost HTTP + APIs)
  └─ public/                      (dependency-free browser UI)

POST /api/report
  └─ src/build-report.mjs
```

Run tests with:

```bash
npm test
```

Check package contents without publishing:

```bash
npm pack --dry-run
```

## Research context

This POC is inspired by:

> Ziqi Yuan, Wenhao Lu, Hao Wu, Dunhong Jin, and Chuan Wu. “Guiding Human Validation of LLM-Generated Code via Verifiable Literate Programming.” arXiv:2607.02333v1.

The paper reports VLP improving code pass@1 from **28.7%–73.2%** to **65.4%–93.5%** across its evaluated settings.

This package demonstrates only a practical version of the human-review workflow. It is **not the full research implementation**: it does not include the paper’s unambiguous literate-language grammar, LLM-based fine-grained mismatch detector, API knowledge base, repair model, formal-property generation, or bounded model checking.

## POC non-goals

- No automatic source edits.
- No code execution or test running against the reviewed project.
- No non-OpenAI-compatible reviewer integrations yet.
- No Python or non-JS/TS language adapters yet.
- No public npm publication in this task.
- No formal guarantee that accepted code matches user intent.
