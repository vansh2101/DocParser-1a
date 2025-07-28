// matching_utils.js
import natural from 'natural';

export function fuzzyMatch(a, b) {
  const lev = natural.LevenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);
  return 1 - lev / maxLen;
}

export function cosineSimilarity(a, b) {
  const tokenizer = new natural.WordTokenizer();
  const aTokens = tokenizer.tokenize(a.toLowerCase());
  const bTokens = tokenizer.tokenize(b.toLowerCase());

  const allTokens = Array.from(new Set([...aTokens, ...bTokens]));
  const aVec = allTokens.map(t => aTokens.filter(x => x === t).length);
  const bVec = allTokens.map(t => bTokens.filter(x => x === t).length);

  const dot = aVec.reduce((sum, val, i) => sum + val * bVec[i], 0);
  const aMag = Math.sqrt(aVec.reduce((sum, val) => sum + val * val, 0));
  const bMag = Math.sqrt(bVec.reduce((sum, val) => sum + val * val, 0));

  return aMag && bMag ? dot / (aMag * bMag) : 0;
}
