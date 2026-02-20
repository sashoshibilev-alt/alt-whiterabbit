/**
 * Process/Ownership Noise Suppression
 *
 * Deterministic rule to suppress candidates that are about process ownership
 * ambiguity rather than real product work. Applies to both normal synthesis
 * anchor lines and B-signal extraction sentences.
 *
 * Does NOT suppress explicit "Owner: X" task assignments tied to delivery.
 */

/**
 * Phrases that indicate process/ownership ambiguity noise.
 * All matches are case-insensitive.
 */
const PROCESS_NOISE_PHRASES = [
  /\bwho\s+owns?\b/i,
  /\bunclear\s+who\b/i,
  /\bambiguity\s+around\b/i,
  /\bambiguous\b/i,
  /\bhandover\b|\bhand[-\s]over\b/i,
  /\bsign.?off\b/i,
  /\bfinal\s+qa\b/i,
  /\bprocess\s+ownership\b/i,
  /\bownership\s+(?:of|around|for|issue|question|ambiguity|gap|problem|concern)\b/i,
];

/**
 * SOC2 amplifier: when combined with a noise phrase, strengthens the signal.
 * Used to catch phrasing like "SOC2 compliance sign-off" even when the
 * primary noise phrase alone might be borderline.
 */
const SOC2_AMPLIFIER = /\bsoc\s*2\b/i;

/**
 * Allowlist: patterns that indicate legitimate "Owner: X" delivery task syntax.
 * If matched, the sentence is NOT suppressed even if noise phrases are present.
 *
 * Kept narrow: only explicit "ROLE to VERB" or "Owner: X" task assignment syntax.
 */
const DELIVERY_OWNERSHIP_ALLOWLIST = [
  /\bowner\s*:\s*\S/i,                              // "Owner: Alice" or "Owner: eng"
  /\bpm\s+to\s+\w/i,                               // "PM to build X" (requires word after "to")
  /\bengineering\s+to\s+\w/i,                       // "Engineering to implement X"
  /\bproduct\s+manager\s+to\s+\w/i,                // "Product Manager to review"
  /\bcustomer\s+success\s+to\s+\w/i,               // "Customer Success to manage"
  /\bcs\s+to\s+\w/i,                               // "CS to follow up"
  /\bdesign\s+to\s+\w/i,                            // "Design to review"
  /\beng\s+to\s+\w/i,                               // "Eng to implement"
  /\bqa\s+to\s+\w/i,                                // "QA to verify"
  /\bsecurity\s+to\s+\w/i,                          // "Security to audit"
  /\blegal\s+to\s+\w/i,                             // "Legal to review"
];

/**
 * Returns true if the text should be suppressed as process/ownership noise.
 *
 * Suppression logic:
 * 1. If any delivery ownership allowlist pattern matches → NOT suppressed.
 * 2. If any noise phrase matches:
 *    a. Always suppressed if noise phrase found.
 *    b. Additionally suppressed if SOC2 amplifier is present (belt-and-suspenders).
 */
export function isProcessNoiseSentence(text: string): boolean {
  // Step 1: Check allowlist — explicit delivery ownership is not noise.
  for (const pattern of DELIVERY_OWNERSHIP_ALLOWLIST) {
    if (pattern.test(text)) {
      return false;
    }
  }

  // Step 2: Check for noise phrases.
  const hasNoise = PROCESS_NOISE_PHRASES.some(p => p.test(text));
  if (!hasNoise) {
    return false;
  }

  // SOC2 amplifier check is informational — the primary noise phrase already fired.
  // Both paths lead to suppression, but we keep this explicit for auditability.
  return true;
}
