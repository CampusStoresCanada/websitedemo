function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deterministicOrder<T>(
  items: T[],
  seed: number,
  keyFn: (item: T) => string
): T[] {
  return [...items]
    .map((item) => {
      const key = keyFn(item);
      const score = hashString(`${seed}:${key}`);
      return { item, score, key };
    })
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.key.localeCompare(b.key);
    })
    .map((entry) => entry.item);
}

export function breakTie(seed: number, leftKey: string, rightKey: string): number {
  const left = hashString(`${seed}:${leftKey}`);
  const right = hashString(`${seed}:${rightKey}`);
  if (left === right) return leftKey.localeCompare(rightKey);
  return left - right;
}
