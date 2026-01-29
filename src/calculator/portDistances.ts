export const defaultDistanceNm = 3000;

export const normalizePortKey = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();

export const simplifyPortLabel = (value: string) => {
  const noParens = value.replace(/\([^)]*\)/g, "");
  const splitDash = noParens.split(/-|â€“|â€”/)[0] ?? noParens;
  const splitComma = splitDash.split(",")[0] ?? splitDash;
  return splitComma.trim();
};

export const tokenizePort = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);

export const resolvePortName = (value: string, ports: string[]) => {
  if (!value) return "";
  const target = normalizePortKey(value);
  if (!target) return "";
  const byNormalized = new Map(ports.map((port) => [normalizePortKey(port), port]));
  if (byNormalized.has(target)) return byNormalized.get(target) ?? value;

  const simplified = simplifyPortLabel(value);
  const simplifiedKey = normalizePortKey(simplified);
  if (simplifiedKey && byNormalized.has(simplifiedKey)) {
    return byNormalized.get(simplifiedKey) ?? simplified;
  }

  let bestSubstringMatch = "";
  let bestSubstringLength = 0;
  const targetTokens = tokenizePort(value);
  if (targetTokens.length > 0) {
    let bestPort = "";
    let bestScore = 0;
    let bestTokenCount = 0;
    for (const port of ports) {
      const portTokens = tokenizePort(port);
      if (portTokens.length === 0) continue;
      const portTokenSet = new Set(portTokens);
      const score = targetTokens.reduce(
        (count, token) => (portTokenSet.has(token) ? count + 1 : count),
        0,
      );
      if (
        score > bestScore ||
        (score === bestScore && score > 0 && portTokens.length > bestTokenCount)
      ) {
        bestScore = score;
        bestTokenCount = portTokens.length;
        bestPort = port;
      }
    }
    if (bestScore > 0) {
      return bestPort;
    }
  }

  for (const port of ports) {
    const portKey = normalizePortKey(port);
    if (target.includes(portKey) || portKey.includes(target)) {
      if (portKey.length > bestSubstringLength) {
        bestSubstringLength = portKey.length;
        bestSubstringMatch = port;
      }
    }
  }
  if (bestSubstringMatch) {
    return bestSubstringMatch;
  }

  return value;
};

export const extractPortFromStatus = (value: string) => {
  if (!value) return "";
  const match = value.match(/discharging\s+(.+)/i);
  if (!match) return value;
  return match[1].trim();
};

export const parseDistanceCsv = (csvText: string) => {
  const lines = csvText.split(/\r?\n/);
  const distanceMap: Record<string, Record<string, number>> = {};
  const portSet = new Set<string>();

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const [fromRaw, toRaw, distanceRaw] = line.split(",");
    if (!fromRaw || !toRaw || !distanceRaw) continue;
    const from = fromRaw.trim();
    const to = toRaw.trim();
    const distance = Number.parseFloat(distanceRaw.trim());
    if (!Number.isFinite(distance)) continue;

    portSet.add(from);
    portSet.add(to);

    if (!distanceMap[from]) distanceMap[from] = {};
    if (!distanceMap[to]) distanceMap[to] = {};
    distanceMap[from][to] = distance;
    distanceMap[to][from] = distance;
  }

  return {
    distanceMap,
    ports: Array.from(portSet).sort(),
  };
};

export const getDistance = (
  distanceMap: Record<string, Record<string, number>>,
  from: string,
  to: string,
) => {
  if (from === to) return 0;
  return distanceMap[from]?.[to] ?? defaultDistanceNm;
};
