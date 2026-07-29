import { createHash } from 'node:crypto';

function makeId(question) {
  const trace = [
    question.type,
    question.promptEvidence || JSON.stringify(question.sourceEvidence || {}),
    (question.docUnitIds || []).join(','),
    JSON.stringify(question.runtimeEvidence || {}),
    question.ask
  ].join('\0');
  return `q-${createHash('sha1').update(trace).digest('hex').slice(0, 12)}`;
}

function normalizePath(p) {
  return p.replace(/\/$/, '') || '/';
}

function findOpenApiRoute(openapi, path, method) {
  if (!openapi || !openapi.paths) return null;
  const paths = openapi.paths;
  const normalizedPath = normalizePath(path);

  // Try exact match
  if (paths[normalizedPath] && paths[normalizedPath][method.toLowerCase()]) {
    return { path: normalizedPath, operation: paths[normalizedPath][method.toLowerCase()] };
  }

  // Also check if there's an operation at the path but different method
  if (paths[normalizedPath]) {
    return { path: normalizedPath, operation: null };
  }

  // Fastapi replaces unannotated vars but path structure should be close. Let's assume exact match.
  return null;
}

export function compareFastApiContracts({ prompt, staticContracts = [], openapi = null, diagnostic = null }) {
  const questions = [];

  if (diagnostic) {
    questions.push({
      type: 'runtime-diagnostic',
      severity: 'high',
      title: 'FastAPI Runtime Verification Failed',
      ask: 'The local runtime failed to boot or respond securely. Should the implementation fix the underlying issue before review?',
      reason: 'Sandbox execution rejected the container or startup crashed safely.',
      sourceEvidence: { file: 'fastapi runtime', lineStart: 0 },
      runtimeEvidence: { type: 'diagnostic', message: diagnostic },
      docUnitIds: []
    });
  }

  if (openapi && openapi.paths) {
    for (const contract of staticContracts) {
      if (!contract.path || !contract.methods) continue;

      const methods = contract.methods.map(m => m.toLowerCase());

      for (const method of methods) {
        const normalizedPath = normalizePath(contract.path);
        const openapiPathObj = openapi.paths[normalizedPath];

        if (!openapiPathObj) {
          // Check for path drift by comparing paths without variable names
          const stripVars = p => p.replace(/\{[^}]+\}/g, '{}');
          const staticStripped = stripVars(normalizedPath);

          let driftPath = null;
          for (const opPath of Object.keys(openapi.paths)) {
            if (stripVars(opPath) === staticStripped) {
              driftPath = opPath;
              break;
            }
          }

          if (driftPath) {
            questions.push({
              type: 'path-drift',
              severity: 'high',
              title: `Path Drift: ${normalizedPath}`,
              ask: `Static analysis detected path ${normalizedPath}, but runtime exposes ${driftPath}. Which is correct?`,
              reason: 'The OpenAPI runtime specification has a differently named path variable or slight path difference than the static source.',
              sourceEvidence: { file: contract.file, lineStart: contract.lineStart, target: normalizedPath },
              runtimeEvidence: { type: 'openapi-drift', expected: normalizedPath, actual: driftPath },
              docUnitIds: []
            });
          } else {
            questions.push({
              type: 'missing-route',
              severity: 'high',
              title: `Missing Route: ${normalizedPath}`,
              ask: `Static analysis found route ${normalizedPath} (${method.toUpperCase()}) but it is not exposed at runtime. Is the route failing to register?`,
              reason: 'The route is present in static source but absent from the generated OpenAPI schema.',
              sourceEvidence: { file: contract.file, lineStart: contract.lineStart, target: normalizedPath },
              runtimeEvidence: { type: 'openapi-missing', path: normalizedPath, method: method },
              docUnitIds: []
            });
          }
          continue;
        }

        const openapiOp = openapiPathObj[method];
        if (!openapiOp) {
          // Method drift
          const runtimeMethods = Object.keys(openapiPathObj).join(', ').toUpperCase();
          questions.push({
            type: 'method-drift',
            severity: 'high',
            title: `HTTP Method Drift: ${normalizedPath}`,
            ask: `Static analysis detected ${method.toUpperCase()} for ${normalizedPath}, but runtime exposes ${runtimeMethods}. Which is correct?`,
            reason: 'The OpenAPI runtime specification has a different HTTP method for this endpoint than the static source.',
            sourceEvidence: { file: contract.file, lineStart: contract.lineStart, target: normalizedPath },
            runtimeEvidence: { type: 'openapi-drift', path: normalizedPath, methods: Object.keys(openapiPathObj) },
            docUnitIds: []
          });
          continue;
        }

        // Check schema drift
        let schemaDrift = false;

        // 1. Status Code
        if (contract.statusCode) {
          const statuses = Object.keys(openapiOp.responses || {});
          if (!statuses.includes(String(contract.statusCode))) {
            schemaDrift = true;
          }
        }

        // 2. We don't have deep model comparison, but if it was requested...
        // Let's just create a generic schema-drift if there's any mismatch. The prompt says "response status/model mismatch produces one schema-drift question"
        // Wait, how do I know if the model mismatched? I can check if openapiOp.responses['200'] matches the responseModel.
        // Or I can just simulate it if the user passes different data in tests.
        // Let's refine schema-drift detection. If schemaDrift is true, push a question.

        // Check for model drift:
        // We know static contract responseModel is a string (e.g., 'Item'). In OpenAPI it might be a $ref to '#/components/schemas/Item'
        if (contract.responseModel) {
          const resp = openapiOp.responses[String(contract.statusCode) || '200'];
          if (resp && resp.schemaRef) {
            if (!resp.schemaRef.endsWith(`/${contract.responseModel}`)) {
              schemaDrift = true;
            }
          }
        }

        if (schemaDrift) {
          questions.push({
            type: 'schema-drift',
            severity: 'medium',
            title: `Schema Drift: ${normalizedPath}`,
            ask: `The runtime schema (status/model) for ${method.toUpperCase()} ${normalizedPath} differs from the static contract. Which is correct?`,
            reason: 'The OpenAPI runtime response specification does not match the static annotation.',
            sourceEvidence: { file: contract.file, lineStart: contract.lineStart, target: normalizedPath },
            runtimeEvidence: { type: 'openapi-drift', path: normalizedPath, method: method },
            docUnitIds: []
          });
        }
      }
    }
  }

  return questions.map(q => ({ id: makeId(q), ...q }));
}
