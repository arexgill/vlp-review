# Product search

Build `searchProducts(products, query, options)`.

- Relevance must consider product name, description, category, and tags.
- Matching must be case-insensitive.
- An empty query returns all products.
- `options.limit` controls the maximum result count; without it, return every match.
- Invalid non-array product input must produce a clear error.
