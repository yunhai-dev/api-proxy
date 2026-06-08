export function modelLookupCandidates(model: string) {
  const candidates: string[] = [];
  const add = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed);
  };

  add(model);
  const withoutBracketSuffix = model.replace(/(?:\[[^\]]+\])+$/, "");
  add(withoutBracketSuffix);

  for (const candidate of [...candidates]) {
    if (candidate.endsWith("-thinking")) add(candidate.slice(0, -"-thinking".length));
  }

  return candidates;
}

export function appendModelVariant(requestedModel: string, matchedModel: string, upstreamModel: string) {
  if (requestedModel === matchedModel) return upstreamModel;
  if (!requestedModel.startsWith(matchedModel)) return upstreamModel;
  return `${upstreamModel}${requestedModel.slice(matchedModel.length)}`;
}

export function modelMatchesAny(model: string, candidates: string[]) {
  return candidates.includes(model);
}
