import { createHash } from 'node:crypto';
import { analyzeSources } from './analyze-source.mjs';
import { detectMismatches } from './detect-mismatches.mjs';

export async function createSession(input) {
  const { docUnits, diagnostics, fastapiStaticContracts } = await analyzeSources(input.sources);
  const questions = detectMismatches({ prompt: input.prompt, docUnits });
  const fingerprint = createHash('sha256')
    .update(input.prompt)
    .update('\0')
    .update(input.sources.map(source => `${source.path}\0${source.content}`).join('\0'))
    .digest('hex')
    .slice(0, 16);

  return Object.freeze({
    id: `session-${fingerprint}`,
    prompt: input.prompt,
    sources: input.sources,
    docUnits,
    diagnostics,
    fastapiStaticContracts,
    questions,
    meta: {
      sourceCount: input.sources.length,
      docUnitCount: docUnits.length,
      questionCount: questions.length,
      engine: 'heuristic-local-poc'
    }
  });
}
