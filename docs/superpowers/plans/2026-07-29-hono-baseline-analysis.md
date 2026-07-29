# Hono Baseline VLP Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a reproducible, bounded local VLP Review baseline for Hono and a human-validated evidence report.

**Architecture:** Keep the third-party Hono checkout outside the VLP repository and unmodified. Commit only compact analysis artifacts: an intent prompt, a source-scope manifest, and a report that summarizes VLP findings and reviewer decisions without reproducing Hono source.

**Tech Stack:** Git shallow clone; Node.js 20+; VLP Review CLI; local browser on `127.0.0.1`; Markdown.

## Global Constraints

- Clone `https://github.com/honojs/hono` shallowly outside the VLP repository; never modify, execute, or commit its source.
- Analyze only supported JS/TS files and at most 200 discovered files, each no larger than 1 MiB.
- Treat Hono documentation as an intent surrogate, not as an original generation prompt.
- Bind the review server only to `127.0.0.1`; do not send Hono source or artifacts to remote services.
- Record the Hono commit SHA, exact source paths, and intent artifact links in committed analysis artifacts.
- Every conclusion must distinguish accepted human judgment from heuristic noise or unresolved questions.

---

## File Structure

- Create: `docs/analysis/hono-baseline-2026-07-29/scope.md` — immutable snapshot metadata and exact included source paths.
- Create: `docs/analysis/hono-baseline-2026-07-29/intent.md` — compact documentation-derived intent artifact supplied to VLP.
- Create: `docs/analysis/hono-baseline-2026-07-29/report.md` — reviewer-validated findings, decisions, and limitations.
- Create outside the repository: `/tmp/tavlin-vlp-hono` — shallow, disposable and unmodified Hono checkout.
- Create outside the repository: `/tmp/tavlin-vlp-hono-input/src` — disposable runtime-only input copied from Hono `src/`, excluding `*.test.*` and `*.spec.*`; this contains 186 supported files at the planning snapshot.

### Task 1: Prepare a Reproducible Hono Source Scope

**Files:**
- Create: `docs/analysis/hono-baseline-2026-07-29/scope.md`

**Interfaces:**
- Consumes: `https://github.com/honojs/hono` default branch.
- Produces: a fixed `Hono SHA`, `source root`, `included paths`, file count, and file-size verification for Tasks 2–4.

- [ ] **Step 1: Create the disposable shallow checkout**

Run:
```bash
rm -rf /tmp/tavlin-vlp-hono
git clone --depth 1 https://github.com/honojs/hono.git /tmp/tavlin-vlp-hono
cd /tmp/tavlin-vlp-hono
git rev-parse HEAD
```

Expected: a full 40-character commit SHA; do not run package install, build, test, or source code.

- [ ] **Step 2: Create the bounded runtime-only VLP input without modifying Hono**

Run:
```bash
rm -rf /tmp/tavlin-vlp-hono-input
mkdir -p /tmp/tavlin-vlp-hono-input/src
cd /tmp/tavlin-vlp-hono
find src -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' \) \
  ! -name '*.test.*' ! -name '*.spec.*' -print0 \
  | while IFS= read -r -d '' path; do
      mkdir -p "/tmp/tavlin-vlp-hono-input/$(dirname "$path")"
      cp "$path" "/tmp/tavlin-vlp-hono-input/$path"
    done
find /tmp/tavlin-vlp-hono-input/src -type f | sort | wc -l
```

Expected: 186 supported runtime files at the planning snapshot. If the refreshed upstream snapshot produces more than 200 files, stop and request a narrowed-scope decision rather than silently excluding additional files.

- [ ] **Step 3: Write the scope manifest**

Create `docs/analysis/hono-baseline-2026-07-29/scope.md` containing:
```markdown
# Hono Baseline Scope

- Repository: https://github.com/honojs/hono
- Revision: <full SHA from Step 1>
- Clone method: `git clone --depth 1`
- Source root: `src/` staged at `/tmp/tavlin-vlp-hono-input/src`
- Included supported files: <integer, maximum 200>
- Largest included file: <relative path and byte count, maximum 1048576>
- Excluded: `*.test.*`, `*.spec.*`, generated output, dependencies, and no source outside `src/`.

## Included paths

```text
<one sorted relative path per line>
```

## Scope rationale

Explain in two to four sentences that all non-test supported source under Hono `src/` is analyzed through a disposable input copy, while tests and source outside `src/` are excluded. State that this exercises core route matching, middleware composition, and request/response code but is not whole-repository coverage.
```

- [ ] **Step 4: Verify the staged source root meets VLP limits**

Run:
```bash
cd /Users/alexgill/TAVLIN/agency/vlp-review-poc/.worktrees/hono-baseline-analysis
node -e "import('./src/load-input.mjs').then(async ({loadInput}) => { const result = await loadInput({ promptPath: 'README.md', codePath: '/tmp/tavlin-vlp-hono-input/src' }); console.log(result.sourceFiles.length); if (result.sourceFiles.length > 200) process.exit(1); })"
```

Expected: exits 0 and prints a count at or below 200. If it exceeds the limit, stop and request a narrower-scope decision before continuing.

- [ ] **Step 5: Commit the scope manifest**

```bash
git add docs/analysis/hono-baseline-2026-07-29/scope.md
git commit -m "docs: record Hono analysis scope"
```

### Task 2: Create the Documentation-Derived Intent Artifact

**Files:**
- Create: `docs/analysis/hono-baseline-2026-07-29/intent.md`

**Interfaces:**
- Consumes: Task 1 scope manifest and Hono public README/documentation at the recorded revision.
- Produces: a VLP-compatible UTF-8 Markdown prompt at `docs/analysis/hono-baseline-2026-07-29/intent.md` for Task 3.

- [ ] **Step 1: Collect only documentation applicable to the selected scope**

Read the relevant README/API documentation and record canonical URLs and headings for routing, middleware, request handling, responses, and documented fallback/error behavior. Do not copy unrelated platform adapter documentation.

- [ ] **Step 2: Write the intent artifact**

Create `docs/analysis/hono-baseline-2026-07-29/intent.md` using this structure:
```markdown
# Hono Core Intent Surrogate

> This artifact summarizes public Hono documentation for VLP Review. It is not an original code-generation prompt and is not an assertion that source diverging from it is defective.

## Sources

- <canonical URL> — <section heading>

## Expected behavior

1. <route matching requirement traceable to a source URL>
2. <middleware ordering/composition requirement traceable to a source URL>
3. <request handling requirement traceable to a source URL>
4. <response construction requirement traceable to a source URL>
5. <fallback or error behavior only if documentation states one>

## Review boundary

Analyze only the paths enumerated in `scope.md`. Framework conventions, platform adapters, performance characteristics, undocumented internals, and behavior outside that path set are out of scope.
```

Use concrete, behavior-oriented language and do not invent requirements to force VLP findings.

- [ ] **Step 3: Validate the artifact can load with the staged source root**

Run:
```bash
cd /Users/alexgill/TAVLIN/agency/vlp-review-poc/.worktrees/hono-baseline-analysis
node bin/vlp-review.mjs \
  --prompt docs/analysis/hono-baseline-2026-07-29/intent.md \
  --code /tmp/tavlin-vlp-hono-input/src \
  --no-open
```

Expected: the CLI prints a localhost review URL and does not report unsupported, empty, over-limit, or unreadable input. Stop the local process after confirming startup.

- [ ] **Step 4: Commit the intent artifact**

```bash
git add docs/analysis/hono-baseline-2026-07-29/intent.md
git commit -m "docs: add Hono intent surrogate"
```

### Task 3: Run the Local VLP Review and Record Decisions

**Files:**
- Modify: `docs/analysis/hono-baseline-2026-07-29/report.md` (created in this task)

**Interfaces:**
- Consumes: Task 1 `scope.md` and Task 2 `intent.md`.
- Produces: an evidence report containing the VLP question count, human decisions, and traceable observations for Task 4.

- [ ] **Step 1: Start the review session locally**

Run:
```bash
cd /Users/alexgill/TAVLIN/agency/vlp-review-poc/.worktrees/hono-baseline-analysis
node bin/vlp-review.mjs \
  --prompt docs/analysis/hono-baseline-2026-07-29/intent.md \
  --code /tmp/tavlin-vlp-hono-input/src
```

Expected: a `http://127.0.0.1:<port>` URL opens locally. Do not expose the server beyond localhost.

- [ ] **Step 2: Review every displayed VLP question in the browser**

For each question, use exactly one VLP decision:
- **Accept behavior** when the source behavior is intentional and documented or a valid framework convention.
- **Correct intent** only when documentation supports a more precise requirement; enter that requirement.
- **Not relevant** when the heuristic’s comparison does not apply to the bounded scope.

Record the question ID, category, source path/line evidence, intent trace, and decision in notes for Step 3. Do not treat an automated question as a defect without human validation.

- [ ] **Step 3: Write the evidence report**

Create `docs/analysis/hono-baseline-2026-07-29/report.md` using this exact outline:
```markdown
# Hono Baseline VLP Analysis Report

## Run metadata

- Repository and revision: <URL and full SHA>
- Source scope: <source root>, <file count> files
- Intent artifact: `intent.md`
- VLP version/revision: <current VLP commit SHA>
- Run date: <ISO date>

## Method and boundary

<Explain that public documentation was used as an intent surrogate, source was parsed but not executed, and the result is not a correctness/security verdict.>

## Question summary

| Decision | Count |
| --- | ---: |
| Accept behavior | <count> |
| Correct intent | <count> |
| Not relevant | <count> |
| Unresolved | <count> |

## Validated observations

### <observation title>

- VLP category: <category>
- Source evidence: `<relative path>:<line range>`
- Intent evidence: <section in intent.md and canonical documentation URL>
- Reviewer decision: <one decision>
- Assessment: <why the evidence supports this judgment, or why it is useful heuristic noise>

## Heuristic noise and limitations

- <Each rejected/irrelevant pattern and why it did not transfer to framework source.>
- <Known blind spots: repository context, TypeScript type semantics, framework conventions, and documentation-surrogate limitations.>

## Outcome

<State whether the baseline met the four success criteria and whether a scoped Hono PR/contract-diff follow-up is recommended.>
```

- [ ] **Step 4: Commit the evidence report**

```bash
git add docs/analysis/hono-baseline-2026-07-29/report.md
git commit -m "docs: report Hono VLP baseline"
```

### Task 4: Verify Artifact Completeness and Report the Result

**Files:**
- Verify: `docs/analysis/hono-baseline-2026-07-29/scope.md`
- Verify: `docs/analysis/hono-baseline-2026-07-29/intent.md`
- Verify: `docs/analysis/hono-baseline-2026-07-29/report.md`

**Interfaces:**
- Consumes: all prior committed artifacts.
- Produces: final verification evidence and a concise handoff to the user.

- [ ] **Step 1: Run the VLP test suite on the final branch state**

```bash
cd /Users/alexgill/TAVLIN/agency/vlp-review-poc/.worktrees/hono-baseline-analysis
npm test
```

Expected: 26 passing tests and 0 failures (or the current full-suite equivalent if the test count changed without source modifications).

- [ ] **Step 2: Validate documentation structure and repository hygiene**

Run:
```bash
cd /Users/alexgill/TAVLIN/agency/vlp-review-poc/.worktrees/hono-baseline-analysis
for file in \
  docs/analysis/hono-baseline-2026-07-29/scope.md \
  docs/analysis/hono-baseline-2026-07-29/intent.md \
  docs/analysis/hono-baseline-2026-07-29/report.md; do
  test -s "$file"
done
git diff --check
git status -sb
git log --oneline -4
```

Expected: all three files are non-empty; no whitespace errors; `/tmp/tavlin-vlp-hono` is absent from Git status.

- [ ] **Step 3: Confirm required report coverage**

Run:
```bash
cd /Users/alexgill/TAVLIN/agency/vlp-review-poc/.worktrees/hono-baseline-analysis
rg -n '^## (Run metadata|Method and boundary|Question summary|Validated observations|Heuristic noise and limitations|Outcome)$' \
  docs/analysis/hono-baseline-2026-07-29/report.md
```

Expected: all six headings appear exactly once.

- [ ] **Step 4: Commit any verification-only documentation correction, if needed**

If Task 4 reveals a missing required report section, correct only the affected Markdown artifact, then run Steps 1–3 again and commit:
```bash
git add docs/analysis/hono-baseline-2026-07-29
git commit -m "docs: complete Hono baseline evidence"
```

If no correction is required, do not create an empty commit.
