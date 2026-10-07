/** Requirement capture is sufficient to enter Stakeholder Q&A. */
export function hasRequirementSource(input: {
  requirementsText: string
  requirementFileName: string | null
}): boolean {
  return Boolean(input.requirementsText.trim() || input.requirementFileName)
}
