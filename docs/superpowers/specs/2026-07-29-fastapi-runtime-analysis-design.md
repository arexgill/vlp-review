# FastAPI Runtime Analysis Design

## Purpose

Extend VLP Review with an opt-in Python/FastAPI analysis mode. It statically extracts FastAPI contracts from Python source, starts an explicitly selected application only in a locked-down Docker sandbox, retrieves only its OpenAPI schema, and presents intent/static/runtime drift as human-review questions.

## Scope

This is a separate feature from Vertex Gemini agent review. It begins with FastAPI applications only and does not add general Python behavior analysis, endpoint smoke tests, database access, credentials, or automatic source edits.

## CLI

FastAPI runtime analysis is explicit:

```bash
vlp-review \
  --prompt intent.md \
  --code ./app \
  --runtime fastapi \
  --fastapi-app package.module:app
```

- `--runtime fastapi` enables Python source discovery, FastAPI static analysis, and the Docker runtime path.
- `--fastapi-app <module:attribute>` is required with `--runtime fastapi`; VLP never guesses or imports the application on the host.
- Existing JS/TS invocation remains unchanged when `--runtime` is absent.

## Static Python analysis

Add `.py` discovery and parse Python through a dedicated adapter without importing or executing project code. Extract evidence for:

- FastAPI application and router declarations;
- route decorators, HTTP methods, and path templates;
- dependency declarations;
- request and response model declarations;
- status codes; and
- exception handlers.

The adapter produces source-linked documentation units and route-contract records. It must preserve parse diagnostics and continue analyzing other readable files when a Python file is invalid.

## Docker runtime boundary

Runtime analysis uses a disposable Docker container. Project source is mounted read-only; no host credentials, home directories, Docker socket, writable host paths, or project secrets are mounted. The runtime container has no external network, bounded CPU/memory/process count, and a startup deadline.

VLP starts Uvicorn for the explicit application target inside the container. A container-local collector polls only `http://127.0.0.1:<port>/openapi.json`, validates the JSON as an OpenAPI document, and writes the result to a temporary in-container output path. The host receives only the bounded OpenAPI JSON and safe diagnostics. It never sends HTTP requests to discovered application endpoints.

The Docker runner uses a fixed Python runtime image and an explicit dependency-install path. Dependency install/build steps are documented as untrusted container work; they have no host credential mounts. The runtime network is disabled after dependencies are available.

## Contract comparison and review

VLP compares user intent, static FastAPI route-contract records, and runtime OpenAPI paths/operations. It generates traceable questions for:

- documented routes absent from static/runtime contracts;
- static/runtime path or HTTP-method disagreement;
- request/response model and status-code disagreement;
- missing response models where intent asserts a response contract; and
- safe runtime diagnostics such as unavailable Docker, startup timeout, invalid target, or invalid OpenAPI output.

The local browser review displays the OpenAPI snapshot summary and runtime diagnostics alongside existing source evidence. Reports include the execution disclosure, app target, static/runtime evidence, and review decisions. Findings remain questions, not correctness proof or source edits.

## Failure behavior

Docker absence, invalid app target, nonzero startup, deadline expiry, unavailable `/openapi.json`, invalid schema JSON, source parse errors, or bounded-output overflow produce safe diagnostics. They do not execute the application on the host, expose raw container output/secrets, or prevent remaining static Python review from completing.

## Testing

Use fixture FastAPI projects and deterministic fake Docker boundaries for parser, CLI, input discovery, contract comparison, report, and UI tests. Docker integration is opt-in and skipped when Docker is unavailable. Test fixtures use no credentials, databases, or external network access.

## Acceptance criteria

- Python FastAPI source is analyzed statically without host execution.
- Runtime mode requires an explicit `module:attribute` target and uses only the Docker sandbox.
- Runtime mode retrieves only a bounded OpenAPI schema; it does not call application endpoints.
- Static and runtime route/schema differences appear as source-linked review questions and report evidence.
- Docker/runtime failures are safe diagnostics and do not block static review.
- Existing JS/TS manual flow and its test suite remain compatible.
