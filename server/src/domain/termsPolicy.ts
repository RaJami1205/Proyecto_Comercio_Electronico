/** Política de versiones del Server. Conservar versiones retiradas para replay compatible. */
export const CURRENT_TERMS_VERSION = '2026-10-lab4-v1'
export const RECOGNIZED_TERMS_VERSIONS: readonly string[] = Object.freeze([CURRENT_TERMS_VERSION])

/** Reconocimiento exacto, sin coerción ni sustitución de la versión declarada. */
export function isRecognizedTermsVersion(version: string): boolean {
  return RECOGNIZED_TERMS_VERSIONS.includes(version)
}

/** Aplicar solo después de resolver Order/pending compatibles. */
export function isCurrentTermsVersion(version: string): boolean {
  return version === CURRENT_TERMS_VERSION
}
