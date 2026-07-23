#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { parseArgs, usage } from '../src/parse-args.mjs';
import { loadInput } from '../src/load-input.mjs';
import { createSession } from '../src/create-session.mjs';
import { createReviewerConfig } from '../src/reviewer-config.mjs';
import { createReviewer } from '../src/reviewers/index.mjs';
import { createAgentReviewService } from '../src/agent-review-service.mjs';
import { createVlpServer, listen } from '../src/server.mjs';
import { openBrowser } from '../src/open-browser.mjs';

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }

    const input = await loadInput({
      promptPath: options.promptPath,
      codePath: options.codePath
    });
    const session = createSession(input);
    const reviewerConfig = createReviewerConfig(options);
    let reviewer = null;
    let reviewerInfo = null;
    let configurationError = null;

    if (reviewerConfig) {
      reviewerInfo = { provider: reviewerConfig.provider, model: reviewerConfig.model };
      if (!reviewerConfig.apiKey) {
        configurationError = 'Set VLP_REVIEWER_API_KEY before running agent review.';
      } else {
        reviewer = createReviewer(reviewerConfig);
      }
    }

    const agentReviewService = reviewerConfig
      ? createAgentReviewService({ session, reviewer, reviewerInfo, configurationError })
      : null;
    const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
    const server = createVlpServer({ session, publicDir, agentReviewService });
    const address = await listen(server, { port: options.port });

    console.log(`Loaded ${session.meta.sourceCount} source file(s), generated ${session.meta.docUnitCount} documentation unit(s), and prioritized ${session.meta.questionCount} question(s).`);

    let review = agentReviewService?.getState() || null;
    if (options.autoReview && agentReviewService) {
      console.log('Running agent review…');
      review = await agentReviewService.run();
      console.log(`Agent review completed: ${review.status}.`);
    }

    console.log(`VLP review ready at ${address.url}`);
    if (review?.status === 'failed' && review.error?.message) {
      console.log(review.error.message);
    }
    console.log('Press Ctrl+C to stop the local server.');

    if (options.open) {
      try {
        await openBrowser(address.url);
      } catch (error) {
        console.warn(`Could not open a browser automatically: ${error.message}`);
        console.warn(`Open ${address.url} manually.`);
      }
    }
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      const port = (() => {
        try {
          return parseArgs(process.argv.slice(2)).port;
        } catch {
          return 4317;
        }
      })();
      console.error(`VLP review failed: Port ${port} is already in use. Try --port <other-number>.`);
    } else {
      console.error(`VLP review failed: ${error.message}`);
    }
    console.error('Use --help to see valid options.');
    process.exitCode = 1;
  }
}

await main();
