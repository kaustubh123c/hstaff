export function validateIndianPAN(panNumber) {
  if (!panNumber || typeof panNumber !== "string") return { valid: false, reason: "INVALID_INPUT" };
  const pan = panNumber.trim().toUpperCase();
  const panRegex = /[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (!panRegex.test(pan)) return { valid: false, reason: "FORMAT_MISMATCH" };
  const entityChar = pan.charAt(3);
  if (entityChar !== 'P') {
    return { valid: false, reason: "NON_INDIVIDUAL_ENTITY_REJECTED", entity: entityChar };
  }
  return { valid: true, entity: "Individual", status: "format_verified_pending_nsdl" };
}
