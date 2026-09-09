export const defaultEstimatedAnalysisSeconds = 180

export const getEstimatedAnalysisSeconds = (mediaSeconds?: number) => {
  if (!Number.isFinite(mediaSeconds) || mediaSeconds === undefined || mediaSeconds <= 0) {
    return defaultEstimatedAnalysisSeconds
  }

  return Math.max(60, Math.ceil(mediaSeconds * 0.35 + 45))
}
