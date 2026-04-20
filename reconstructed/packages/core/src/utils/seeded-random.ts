/**
 * A simple seeded random number generator based on a string seed.
 * @param seed - The string seed to use for random number generation
 * @param min - The minimum value (inclusive)
 * @param max - The maximum value (inclusive)
 * @returns A random number between min and max (inclusive)
 */
export function getNonSecureSeededRandomNumber(
  seed: string,
  min: number,
  max: number
): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    // eslint-disable-next-line unicorn/prefer-code-point
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  const randomValue = Math.abs((Math.sin(hash) * 10_000) % 1);
  return Math.floor(randomValue * (max - min + 1)) + min;
}
