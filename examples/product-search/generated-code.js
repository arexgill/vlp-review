export function searchProducts(products, query, options = {}) {
  if (!Array.isArray(products)) return [];
  if (!query) return products;

  const normalizedQuery = String(query).toLowerCase();
  return products
    .filter(product => String(product.name ?? '').toLowerCase().includes(normalizedQuery))
    .slice(0, 25);
}
