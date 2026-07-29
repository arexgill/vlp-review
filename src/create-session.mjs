import { createHash } from 'node:crypto';
import { analyzeSources } from './analyze-source.mjs';
import { detectMismatches } from './detect-mismatches.mjs';
import { compareFastApiContracts } from './fastapi-contracts.mjs';

async function getRuntimeData(input, collectFastApiOpenApi) {
  if (input.runtime !== 'fastapi' || !collectFastApiOpenApi) {
    return { openapi: null, diagnostic: null };
  }
  const result = await collectFastApiOpenApi({
    codePath: input.codeRoot,
    appTarget: input.fastapiApp,
    timeoutMs: 15000
  });
  return {
    openapi: result.openapi,
    diagnostic: result.diagnostic ? `${result.diagnostic.type}: ${result.diagnostic.message}` : null
  };
}

export async function createSession(input, inject = {}) {
  const { docUnits, diagnostics, fastapiStaticContracts } = await analyzeSources(input.sources);
  const runtimeData = await getRuntimeData(input, inject.collectFastApiOpenApi);

  const fastapiQuestions = compareFastApiContracts({
    prompt: input.prompt,
    staticContracts: fastapiStaticContracts,
    openapi: runtimeData.openapi,
    diagnostic: runtimeData.diagnostic
  });

  const questions = detectMismatches({ prompt: input.prompt, docUnits, fastapiQuestions });

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
    openapi: runtimeData.openapi,
    runtimeDiagnostic: runtimeData.diagnostic,
    fastapiApp: input.fastapiApp || null,
    questions,
    meta: {
      sourceCount: input.sources.length,
      docUnitCount: docUnits.length,
      questionCount: questions.length,
      engine: 'heuristic-local-poc'
    }
  });
}
