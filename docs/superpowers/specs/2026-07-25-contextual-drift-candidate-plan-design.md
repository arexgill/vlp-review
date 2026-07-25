# Tavlin Contextual Drift Candidate Plan Design

## Purpose

Create a self-contained HTML planning document that recommends GitHub repositories for contextual-drift analysis using the TAVLIN VLP Review proof of concept. The document should help a partner decide what to analyze first and execute each analysis consistently.

## Audience and decision

The audience is a TAVLIN partner who understands the product and can assess technical evidence without reading the implementation. The document asks the partner to approve a hybrid evaluation ladder:

1. Whole-repository calibration: Hono, Zod, and OpenAI Node.
2. Scoped contextual-drift analysis: TanStack Query, Vercel AI SDK, and Better Auth.
3. Reference comparison: PX Pipe, HyperFrames, and OpenCode from the existing repository-evaluation specification.

## Selection criteria

Each candidate is evaluated on:

- GitHub attention: stars, forks, and ecosystem relevance.
- Community activity: recent pushes, issues, pull requests, and contribution signal.
- Scope: compatibility with the current VLP JavaScript/TypeScript boundary and 200-source-file limit, either whole-repository or bounded scope.
- Drift value: clarity and richness of specifications, contracts, tests, API behavior, error paths, and evolving requirements.
- Speed to evidence: whether an initial analysis can produce useful findings quickly.

Repository metadata is labeled as an approximate snapshot from GitHub metadata retrieved during research, not as a permanent ranking.

## Candidate recommendations

### Primary candidates

- Hono: whole-repository baseline; routing and Web API contract drift.
- Zod: whole-repository contract baseline; schema, validation, type, and error drift.
- OpenAI Node: whole-repository SDK baseline; API, streaming, compatibility, and error drift.
- TanStack Query: scoped core package or one mature PR; cache, invalidation, lifecycle, and multi-adapter drift.
- Vercel AI SDK: scoped provider or streaming package plus one recent feature/PR; rapidly evolving AI protocol drift.
- Better Auth: scoped authentication feature or PR; security, session, adapter, and error-contract drift.

### Secondary candidates

Drizzle ORM, Trigger.dev, Effect, and Payload remain valuable follow-up candidates but are deferred from the first pass because they require narrower scope or have a higher initial complexity/size cost.

### Reference candidates

PX Pipe, HyperFrames, and OpenCode remain in the plan as comparison cases from the existing one-pager. Their purpose is to preserve continuity with the prior evaluation design rather than to replace the new shortlist.

## Per-project plan

Every project card must state:

1. Recommended scope.
2. Context artifacts to collect: README/spec, issue or PR, commit range, tests, and relevant comments.
3. Drift hypotheses to test.
4. VLP execution sequence: prepare prompt/context, select source scope, run analysis, inspect evidence, validate findings, and produce a report.
5. Expected outputs.
6. Success gate.
7. Main risk or exclusion.

Whole-repository candidates must explicitly note the current parser and file limits. Scoped candidates must identify the boundary before analysis and must not imply that a whole repository was analyzed.

## Execution schedule

Use a two-week, ten-working-day plan:

- Days 1–2: establish rubric, run Hono and Zod, calibrate evidence quality.
- Day 3: run OpenAI Node and compare whole-repository results.
- Days 4–5: analyze TanStack Query core or a bounded PR.
- Days 6–7: analyze a Vercel AI SDK provider/streaming slice.
- Days 8–9: analyze one Better Auth feature/PR and compare drift patterns.
- Day 10: compare against PX Pipe, HyperFrames, and OpenCode; decide whether to continue, revise scope/method, or stop.

## Measurement framework

Record for every run:

- source files and scope analyzed;
- context artifacts and commit range;
- number of generated questions;
- accepted, corrected, irrelevant, and unresolved findings;
- evidence traceability;
- reviewer time;
- repair usefulness;
- false-positive and false-negative observations;
- whether the finding represents temporal drift, intent-transfer drift, or heuristic noise.

The document must emphasize that accepted findings are human judgments, not correctness proofs.

## HTML deliverable

Create `docs/tavlin-contextual-drift-candidate-plan.html` with:

- semantic, self-contained HTML;
- inline CSS only;
- no JavaScript or external assets;
- responsive desktop/mobile layout;
- print-friendly styles;
- TAVLIN visual language: navy, off-white, teal, restrained coral/amber status colors, system fonts, compact cards, and strong information hierarchy;
- working links to canonical GitHub repositories;
- clear metadata and methodology limitations;
- no private information or placeholder content.

The page should be readable as a scrolling planning brief and remain useful in print. It should make the recommendation understandable within 30 seconds while retaining enough detail to execute each candidate analysis.
