# Hono Baseline VLP Analysis Design

## Purpose

Run the first external-repository baseline with the TAVLIN VLP Review POC. Establish whether a bounded, real TypeScript framework slice produces understandable and actionable human-review questions when its published documentation is used as the intent artifact.

## Repository and scope

- Repository: `https://github.com/honojs/hono`
- Revision: the shallow-cloned default-branch HEAD, recorded in the final report.
- Source scope: a bounded core routing/middleware/request-response slice selected after a shallow tree inspection. The selected directory must contain at most 200 supported JS/TS files and each file must be within VLP's 1 MiB input limit.
- Exclusions: generated files, dependencies, build output, tests unless they are needed only as supporting human evidence, and unrelated adapters or platform integrations.

The analysis must state the exact paths included; it must not claim whole-repository coverage.

## Intent artifacts

Use the Hono README and the documentation sections that describe the selected public behavior as a compact, reviewable Markdown prompt. The prompt records expected route matching, middleware execution, request handling, response behavior, and documented error or fallback behavior that applies to the selected scope.

Documentation is a surrogate for an original code-generation prompt. Findings therefore measure documentation-to-source traceability, not proof that Hono is defective.

## Workflow

1. Shallow-clone Hono into a temporary directory outside the VLP repository and record the commit SHA.
2. Inspect the source tree and choose the smallest core slice that supports a meaningful baseline.
3. Collect relevant public documentation and write a local intent prompt with source links/attribution.
4. Run `vlp-review` locally with that prompt and source directory, without importing or executing Hono source.
5. Inspect the browser review and record each finding as accepted, corrected, irrelevant, or unresolved.
6. Produce a Markdown evidence report with revision, exact scope, intent artifacts, VLP output summary, reviewer decisions, useful findings, heuristic noise, and limitations.

## Safety and boundaries

- No Hono source is executed, modified, committed, or sent to remote services.
- No credentials are required or collected.
- The local VLP server remains bound to `127.0.0.1`.
- This is an exploratory baseline, not a security audit or correctness verdict.

## Success criteria

The run is useful when it:

1. completes within VLP's input limits;
2. produces findings that a reviewer can trace to both documentation and source;
3. yields at least one actionable observation or a well-supported conclusion that the current heuristics are too weak for this source shape; and
4. records enough scope and decision evidence to compare later Hono/other-repository runs.

## Deliverables

- This design document.
- A local, uncommitted shallow clone of Hono used solely for analysis.
- A local intent prompt and a Markdown analysis report committed to the Hono-analysis branch. The report contains no copied source beyond minimal path/line evidence needed to explain a finding.
