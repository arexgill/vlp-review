# Task 4 Status Report

## Re-review Fixes

### 1. Markdown rendering for FastAPI evidence
- Updated `src/build-report.mjs` to render explicit `- **Source evidence:**` and `- **Runtime OpenAPI evidence:**` labels.
- Source evidence now includes the file, line number, and route target bounded operation.
- Runtime evidence prints diagnostic messages or the operation paths/methods.
- Added exact Markdown regression test in `test/build-report.test.mjs`.

### 2. Deterministic end-to-end FastAPI test
- Replaced the ambiguous `either-success-or-diagnostic` assertion in `test/cli.test.mjs` with two dedicated tests.
- Created `fake-docker` and `fake-docker-fail` mocks to inject deterministic outcomes via the `PATH` environment variable.
- Verified that the failure test correctly captures the `build_error` diagnostic.
- Proved that the happy-path test populates `openapi` metadata, generates an actual `method-drift` question, and correctly renders the exact labels in the final report API response.
- Created a `requirements.txt` file in the basic fixture app so Docker checks pass successfully and hit the CLI mocked endpoint.

### 3. Final Re-review Fixes
- Aligned README and design specs to explicitly state that host `python3` only ever executes the repository-owned AST extraction script (`scripts/extract-fastapi.py`). The helper reads source over `stdin` and never imports, evaluates, or executes the target app.
- Added a Node regression test (`test/extract-fastapi.test.mjs`) to assert the helper script only imports `ast`, `json`, `sys` and lacks any instances of `__import__`, `importlib`, `exec`, `eval`, `subprocess`.
- Added a fake-spawn test (`test/python-analyzer.test.mjs`) proving only the exact resolved repository helper path is invoked, receiving code via `stdin`.
- Implemented recursive literal router-prefix composition across nested `include_router()` chains in `scripts/extract-fastapi.py`, adding cycle protection (`visited` set) and deterministic bottom-up evaluation.
- Added an exact nested integration test in `test/extract-fastapi.test.mjs` resolving router `/items` -> `/api` (with `/v1`) -> app (with `/root`), yielding the exact `/root/api/v1/items/{item_id}`.
