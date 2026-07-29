# Hono Core Intent Surrogate

> This artifact summarizes public Hono documentation for VLP Review. It is not an original code-generation prompt and is not an assertion that source diverging from it is defective.

## Sources

- https://hono.dev/docs/api/routing — Routing
- https://hono.dev/docs/api/middleware — Middleware
- https://hono.dev/docs/api/context — Context
- https://hono.dev/docs/api/exception — Error Handling

## Expected behavior

1. The framework must match incoming HTTP requests to registered routes based on exact paths, parameter patterns (e.g., `:id`), and wildcards (e.g., `*`) (source: https://hono.dev/docs/api/routing).
2. Middleware must compose sequentially in registration order, using `await next()` to yield execution to downstream handlers and resume upon their completion (source: https://hono.dev/docs/api/middleware).
3. The framework must provide a unified `Context` object (`c`) to handlers, exposing methods to inspect request properties like headers, query parameters, route parameters, and payloads (source: https://hono.dev/docs/api/context).
4. Handlers must construct responses either by returning web standard `Response` objects directly or using `Context` utility methods such as `c.text()`, `c.json()`, and `c.html()` (source: https://hono.dev/docs/api/context).
5. The application must invoke configured `app.notFound()` or return a 404 response for unmatched routes, and invoke `app.onError()` or return a 500 response for unhandled exceptions (source: https://hono.dev/docs/api/exception).

## Review boundary

Analyze only the paths enumerated in `scope.md`. Framework conventions, platform adapters, performance characteristics, undocumented internals, and behavior outside that path set are out of scope.
