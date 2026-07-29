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
