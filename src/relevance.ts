export function scoreRelevance(
  context: string,
  server: { name: string; namespace: string },
  tools: Array<{ name: string; description?: string }>,
): number {
  const contextLower = context.toLowerCase();
  const words = contextLower
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);

  if (words.length === 0) return 0;

  let score = 0;
  const nameLower = server.name.toLowerCase();
  const nsLower = server.namespace.toLowerCase();

  for (const word of words) {
    if (nameLower.includes(word)) score += 3;
    if (nsLower.includes(word)) score += 2;
    for (const tool of tools) {
      if (tool.name.toLowerCase().includes(word)) score += 2;
      if (tool.description?.toLowerCase().includes(word)) score += 1;
    }
  }

  return score;
}
