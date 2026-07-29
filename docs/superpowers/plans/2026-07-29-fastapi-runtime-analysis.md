# FastAPI Runtime Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in FastAPI static and Docker-sandboxed OpenAPI analysis while preserving existing JS/TS local review behavior.

**Architecture:** Create a Python AST adapter and normalized FastAPI route-contract records, then add a Docker runner that returns only bounded OpenAPI JSON or safe diagnostics. Feed static/runtime contracts into the existing session, mismatch detector, browser, and repair report as evidence; never execute project Python on the host.

**Tech Stack:** Node.js ESM, Python standard-library `ast` through a fixed container helper, Docker CLI behind an injected runner, FastAPI fixture projects, Node test runner.

## Global Constraints

- `--runtime fastapi` and `--fastapi-app module:attribute` are both required for runtime execution.
- No Python project code is imported, executed, or installed on the host. Host `python3` may run only the repository-owned `scripts/extract-fastapi.py` helper which receives source over stdin and uses standard libraries `ast/json/sys` without importing the target app.
- Docker source mount is read-only; no host credentials, home, Docker socket, writable host paths, or external runtime network.
- Runtime output is limited to OpenAPI JSON and safe diagnostics; do not request discovered endpoints.
- Docker failures do not prevent static Python analysis.
- Existing JS/TS behavior remains unchanged when `--runtime` is absent.
- Fixtures/fakes only in tests; Docker integration is explicit and skipped when Docker is unavailable.

---

## File Structure

- Create: `src/python-analyzer.mjs` — invokes fixed Python AST helper and normalizes source-linked FastAPI records.
- Create: `src/fastapi-contracts.mjs` — compares intent/static/runtime route contracts into VLP questions.
- Create: `src/fastapi-runtime.mjs` — injected Docker command construction, bounded OpenAPI collection, and safe diagnostics.
- Create: `scripts/extract-fastapi.py` — no-import Python AST helper reading JSON from stdin and writing JSON to stdout.
- Create: `scripts/collect-openapi.py` — container-local OpenAPI collector; requests only localhost `/openapi.json`.
- Create: `test/python-analyzer.test.mjs`, `test/fastapi-contracts.test.mjs`, `test/fastapi-runtime.test.mjs`.
- Create: `test/fixtures/fastapi-basic/app/main.py`, `test/fixtures/fastapi-basic/requirements.txt`.
- Modify: `src/parse-args.mjs`, `src/load-input.mjs`, `src/analyze-source.mjs`, `src/create-session.mjs`, `src/detect-mismatches.mjs`, `src/build-report.mjs`, `src/server.mjs`, `public/app.js`, `README.md` and their existing tests.

### Task 1: FastAPI CLI and Safe Python Source Discovery

**Files:**
- Modify: `src/parse-args.mjs`, `src/load-input.mjs`, `test/parse-args.test.mjs`, `test/load-input.test.mjs`

**Interfaces:**
- `parseArgs(argv)` returns `runtime: null | 'fastapi'` and `fastapiApp: null | 'module:attribute'`.
- `loadInput({ promptPath, codePath, runtime })` includes `.py` only when `runtime === 'fastapi'`.

- [ ] **Step 1: Write failing CLI tests**

```js
test('requires a module attribute for FastAPI runtime', () => {
  assert.throws(() => parseArgs(['--prompt', 'intent.md', '--code', 'app', '--runtime', 'fastapi']), /--fastapi-app/);
  assert.throws(() => parseArgs(['--prompt', 'intent.md', '--code', 'app', '--fastapi-app', 'app.main:app']), /--runtime fastapi/);
  assert.deepEqual(parseArgs(['--prompt', 'intent.md', '--code', 'app', '--runtime', 'fastapi', '--fastapi-app', 'app.main:app']).runtime, 'fastapi');
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test test/parse-args.test.mjs`

Expected: current parser rejects unknown runtime flags.

- [ ] **Step 3: Implement parser validation and Python discovery**

Accept only literal `fastapi`; validate app target with `/^[A-Za-z_][\w.]*:[A-Za-z_]\w*$/`. Preserve `.py` exclusion outside FastAPI mode. Add a fixture discovery test proving deterministic `.py` inclusion, existing ignored directories, 200-file limit, and no file execution.

- [ ] **Step 4: Verify focused tests**

Run: `node --test test/parse-args.test.mjs test/load-input.test.mjs`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/parse-args.mjs src/load-input.mjs test/parse-args.test.mjs test/load-input.test.mjs
git commit -m "feat: add FastAPI runtime CLI inputs"
```

### Task 2: Static Python/FastAPI Contract Extraction

**Files:**
- Create: `scripts/extract-fastapi.py`, `src/python-analyzer.mjs`, `test/python-analyzer.test.mjs`
- Modify: `src/analyze-source.mjs`, `src/create-session.mjs`, `test/analyze-source.test.mjs`, `test/create-session.test.mjs`

**Interfaces:**
- Python helper consumes `{ files: [{ path, source }] }` stdin JSON and emits `{ units, routes, diagnostics }` JSON.
- Route record is `{ file, lineStart, path, methods, dependencies, requestModel, responseModel, statusCode, exceptionHandler }`.

- [ ] **Step 1: Write failing adapter test**

Use `test/fixtures/fastapi-basic/app/main.py` with `@app.get('/items/{item_id}', response_model=Item, status_code=200)` and an exception handler. Assert exact path, method, model, status, and source line. Add invalid Python fixture assertion that preserves a diagnostic while valid files remain available.

- [ ] **Step 2: Run and verify failure**

Run: `node --test test/python-analyzer.test.mjs`

Expected: helper/adapter module is absent.

- [ ] **Step 3: Implement no-import AST helper**

Use only Python `ast`, `json`, and stdin/stdout. Do not import FastAPI or target modules. Recognize `FastAPI`, `APIRouter`, decorator method names (`get`, `post`, `put`, `patch`, `delete`, `api_route`), keyword route metadata, `Depends`, response/request model annotations, and `exception_handler`. Emit bounded strings/arrays and parse errors with path/line only.

- [ ] **Step 4: Integrate static units/session metadata**

Add Python documentation units and `fastapiStaticContracts` to the existing analysis/session shape without changing JS units. Ensure parse failures appear in existing diagnostics.

- [ ] **Step 5: Verify focused tests**

Run: `node --test test/python-analyzer.test.mjs test/analyze-source.test.mjs test/create-session.test.mjs`

Expected: pass without importing fixture Python.

- [ ] **Step 6: Commit**

```bash
git add scripts/extract-fastapi.py src/python-analyzer.mjs src/analyze-source.mjs src/create-session.mjs test/python-analyzer.test.mjs test/analyze-source.test.mjs test/create-session.test.mjs test/fixtures/fastapi-basic
git commit -m "feat: extract static FastAPI contracts"
```

### Task 3: Docker-Confined OpenAPI Collection

**Files:**
- Create: `scripts/collect-openapi.py`, `src/fastapi-runtime.mjs`, `test/fastapi-runtime.test.mjs`

**Interfaces:**
- `collectFastApiOpenApi({ codePath, appTarget, runDocker, timeoutMs })` resolves `{ openapi, diagnostic }` where exactly one is non-null.
- `runDocker(args, { signal })` is injected in tests; production uses a spawned Docker CLI only.

- [ ] **Step 1: Write failing Docker-command and failure tests**

Assert generated Docker arguments include read-only source mount, `--network none`, `--read-only`, `--tmpfs /tmp`, CPU/memory/PID limits, explicit fixed image, and no home/credential/socket mounts. Assert the collector accepts bounded valid OpenAPI JSON only and maps Docker absence, timeout, nonzero exit, invalid JSON, and oversized output to safe diagnostics with no raw output.

- [ ] **Step 2: Run and verify failure**

Run: `node --test test/fastapi-runtime.test.mjs`

Expected: runtime module is absent.

- [ ] **Step 3: Implement container-local collector**

`collect-openapi.py` polls only `http://127.0.0.1:8000/openapi.json` inside the container after Uvicorn starts. It writes only JSON/error code to stdout. The host runner mounts project source read-only, uses a disposable container, bounds stdout, kills on deadline, and validates OpenAPI has object `paths`. It never publishes ports or calls application routes.

- [ ] **Step 4: Verify focused tests**

Run: `node --test test/fastapi-runtime.test.mjs`

Expected: pass with fake runner; no Docker daemon required.

- [ ] **Step 5: Commit**

```bash
git add scripts/collect-openapi.py src/fastapi-runtime.mjs test/fastapi-runtime.test.mjs
git commit -m "feat: collect FastAPI OpenAPI in Docker sandbox"
```

### Task 4: Contract Drift Questions, UI, Reports, and Full Verification

**Files:**
- Create: `src/fastapi-contracts.mjs`, `test/fastapi-contracts.test.mjs`
- Modify: `src/detect-mismatches.mjs`, `src/create-session.mjs`, `src/build-report.mjs`, `src/server.mjs`, `public/app.js`, `README.md`
- Modify: `test/detect-mismatches.test.mjs`, `test/build-report.test.mjs`, `test/server.test.mjs`, `test/ui-contract.test.mjs`

**Interfaces:**
- `compareFastApiContracts({ prompt, staticContracts, openapi, diagnostic })` returns deterministic VLP question objects with source/runtime evidence.

- [ ] **Step 1: Write failing contract tests**

Assert static `GET /items/{item_id}` versus runtime `POST /items/{item_id}` produces one method-drift question; response status/model mismatch produces one schema-drift question; Docker diagnostic produces one safe runtime-diagnostic question; matching contract produces none. Assert source path/line and OpenAPI operation evidence are present.

- [ ] **Step 2: Run and verify failure**

Run: `node --test test/fastapi-contracts.test.mjs`

Expected: comparison module is absent.

- [ ] **Step 3: Integrate questions and UI/report artifacts**

Merge FastAPI questions with existing deterministic prioritization. Add local API/session fields for sanitized OpenAPI summary and runtime diagnostic. Render a runtime disclosure, app target, route count, and diagnostics; never expose raw container output. Add report sections for execution boundary, static/runtime evidence, and decisions. Document Docker prerequisite, explicit opt-in, exact safety limits, no endpoint calls, and integration-test opt-in.

- [ ] **Step 4: Run complete verification**

```bash
npm test
git diff --check
node bin/vlp-review.mjs --prompt test/fixtures/fastapi-basic/intent.md --code test/fixtures/fastapi-basic/app --runtime fastapi --fastapi-app app.main:app --no-open
```

Expected: full existing suite passes; the last command either starts sandbox runtime with a safe OpenAPI result or records a safe Docker diagnostic, never executes Python on the host.

- [ ] **Step 5: Commit**

```bash
git add src/fastapi-contracts.mjs src/detect-mismatches.mjs src/create-session.mjs src/build-report.mjs src/server.mjs public/app.js README.md test/fastapi-contracts.test.mjs test/detect-mismatches.test.mjs test/build-report.test.mjs test/server.test.mjs test/ui-contract.test.mjs
git commit -m "feat: review FastAPI static and OpenAPI contracts"
```
