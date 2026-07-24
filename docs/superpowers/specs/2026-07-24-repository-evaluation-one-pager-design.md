# TAVLIN VLP Repository Evaluation One-Pager Design

## Purpose

Create a self-contained HTML one-pager that lets a TAVLIN partner evaluate and approve a focused repository-analysis pilot. The page combines a recommendation, supporting scorecard, two-week plan, and explicit decision criteria.

## Audience and tone

The primary audience is a TAVLIN business partner who understands the product and can evaluate technical evidence without needing implementation-level detail. The tone is balanced technical/product: concise, credible, and decision-oriented rather than promotional or academic.

## Decision requested

Approve a two-week pilot using three repositories in sequence:

1. **PX Pipe** — whole-repository baseline within the current VLP parser and file limits.
2. **HyperFrames** — spec-to-implementation transferability test using a bounded package or PR.
3. **OpenCode** — advanced contract-diff test using one written specification and its related implementation.

## Page structure

The HTML must fit naturally on one printed landscape page while remaining readable on desktop and mobile.

1. **Header**
   - Title: “TAVLIN VLP Repository Evaluation”
   - Subtitle identifying the artifact as a partner decision brief.
   - Compact statement of the current VLP boundary: JS/TS analysis, 200-source-file cap, and intent comparison requirement.

2. **Executive recommendation**
   - State the three-repository pilot recommendation.
   - Explain that the sequence tests baseline feasibility, transferability, and complex contract reasoning.
   - Include a prominent “Decision requested” label.

3. **Candidate scorecard**
   - Show the strongest current candidates: PX Pipe, HyperFrames, OpenCode, Cavemem, Firecrawl, Remotion, and Immich.
   - Score each candidate on:
     - current VLP compatibility;
     - strength of intent/specification evidence;
     - ability to isolate a manageable scope;
     - behavioral or contract richness.
   - Use short labels rather than unexplained numeric precision.
   - Clearly identify the recommended pilot role for the top three.

4. **Deferred candidates**
   - Group SkillSpector, Graphify, Browser Use, Agent Cookie, Tailscale, Baidu Unlimited OCR, and Zapier MCP.
   - Give each a concise reason: unsupported primary language, model-heavy semantics, excessive initial scope, or lack of executable JS/TS implementation.
   - Make clear that “deferred” does not mean low-quality.

5. **Two-week pilot**
   - Days 1–3: PX Pipe baseline and reviewer calibration.
   - Days 4–7: HyperFrames spec-driven analysis.
   - Days 8–10: OpenCode scoped contract-diff analysis.
   - Days 11–14: compare findings, measure reviewer value, and prepare the recommendation.

6. **Success gates and final decision**
   - Measure whether findings are understandable, actionable, and traceable to intent and source.
   - Record reviewer acceptance/rejection to estimate signal-to-noise rather than claiming formal correctness.
   - Compare analysis effort with the value of the resulting repair or review brief.
   - End with three possible outcomes: continue, revise scope/method, or stop.

7. **Methodology note**
   - State that repository counts came from a shallow default-branch tree scan.
   - State that test counts and artifact classifications are filename-based indicators, not full audits.
   - Link repository names to their canonical GitHub pages.

## Visual direction

- Use a professional TAVLIN-style navy, off-white, and teal palette.
- Give the scorecard the strongest visual weight.
- Use compact cards and restrained status badges rather than decorative charts.
- Maintain high contrast and avoid tiny body text.
- Use system fonts and no external assets or dependencies.
- Include print CSS targeting a single landscape A4 or Letter page.
- On narrow screens, stack sections and allow the scorecard to scroll horizontally if necessary.

## Deliverable

Create one portable file at `docs/tavlin-vlp-repository-evaluation.html`. It must contain all CSS inline, use semantic HTML, require no JavaScript, and contain no private information.

## Acceptance criteria

- The recommendation and requested decision are understandable within 30 seconds.
- The scorecard explains why the top three were selected without relying on repository popularity.
- Every repository from the supplied list is represented as either a current candidate or a deferred candidate.
- Current VLP constraints are stated accurately.
- The pilot has a concrete sequence, duration, outputs, and decision gate.
- Repository links work when the file is opened in a browser.
- The page is readable at common desktop widths and in print preview.
- The HTML has no external runtime dependency and no placeholder content.
