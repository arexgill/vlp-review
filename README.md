# VLP Review POC

A local npm CLI for validating vibe-coded JavaScript and TypeScript against the prompt that generated it.

VLP Review reads the original prompt and generated source, creates syntax-directed “literate” documentation, prioritizes suspicious intent/implementation mismatches, and opens an interactive browser review. Your decisions become a repair-ready Markdown brief for a coding agent.

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

## CLI

```text
vlp-review --prompt <file> --code <file-or-directory> [--port <number>] [--no-open]
```

| Option | Meaning |
| --- | --- |
| `--prompt <file>` | Required UTF-8 text or Markdown prompt. |
| `--code <path>` | Required generated source file or directory. |
| `--port <number>` | Local port from 1–65535. Default: `4317`. |
| `--no-open` | Start the server without opening a browser. |
| `-h`, `--help` | Print usage. |

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

Responses persist in browser `localStorage` under the session fingerprint, so a refresh does not discard the review. The final brief can be copied or downloaded.

## Privacy and security boundaries

- The HTTP server binds only to `127.0.0.1`.
- Prompt, source, documentation, and responses are never sent to a remote service.
- No LLM API key is required.
- Source is parsed as text and is never imported, executed, or evaluated.
- Static serving uses an allowlist; project files cannot be fetched through the server.
- API request bodies are limited to 256 KiB.
- Responses use a restrictive Content Security Policy and `no-store` caching.

You can confirm the local boundary in browser developer tools: session traffic should include only the current `127.0.0.1` origin.

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
- No remote model integration.
- No Python or non-JS/TS language adapters yet.
- No public npm publication in this task.
- No formal guarantee that accepted code matches user intent.
