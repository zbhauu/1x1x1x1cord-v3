type PatchHandler = (request: Request) => Request | void;

interface Patch {
  urlPattern: string;
  priority: number;
  handler: PatchHandler;
}

const patches: Patch[] = [
  { urlPattern: '/api/v9/channels', priority: 10, handler: (req) => req },
  { urlPattern: '/api/v9/guilds', priority: 9, handler: (req) => req },
  { urlPattern: '/api/v9/messages', priority: 8, handler: (req) => req },
];

const endpointMap: Map<string, Patch[]> = new Map();

for (const patch of patches) {
  const parts = patch.urlPattern.split('/').filter(Boolean);
  const key = parts.slice(0, 2).join('/');
  if (!endpointMap.has(key)) endpointMap.set(key, []);
  endpointMap.get(key)!.push(patch);
}

export function getPatchesForUrl(url: string): Patch[] {
  const result: Patch[] = [];
  for (const [key, patchList] of endpointMap.entries()) {
    if (url.includes(key)) {
      result.push(...patchList);
    }
  }
  result.sort((a, b) => b.priority - a.priority);
  return result;
}

export { patches, Patch, PatchHandler };
