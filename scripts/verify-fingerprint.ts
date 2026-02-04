/**
 * Fingerprint Verification Script
 * 
 * Run: npx tsx scripts/verify-fingerprint.ts
 * 
 * This verifies the patched code is actually running by checking for FP3 fingerprint.
 */

import { generateSuggestionsWithDebug } from '../src/lib/suggestion-engine-v2';

const testNote = {
  note_id: 'fingerprint-test',
  raw_markdown: `# Q3 Planning

## Roadmap Adjustments

Shift focus from enterprise to SMB customers.

- Defer enterprise features
- Focus on self-serve onboarding
`,
};

console.log('=== FINGERPRINT VERIFICATION ===\n');

const result = generateSuggestionsWithDebug(
  testNote,
  undefined,
  { enable_debug: true },
  { verbosity: 'REDACTED' }
);

if (!result.debugRun) {
  console.error('ERROR: No debugRun in result!');
  process.exit(1);
}

const debugRun = result.debugRun;

console.log('1. Root __fingerprint:', debugRun.__fingerprint || 'MISSING');
console.log('2. meta.generatorVersion:', debugRun.meta.generatorVersion);
console.log('3. meta.runtimeFingerprint:', debugRun.meta.runtimeFingerprint || 'MISSING');
console.log('4. config.additionalFlags.planChangeProtection:', debugRun.config.additionalFlags?.planChangeProtection);
console.log('5. config.additionalFlags.runtimeFingerprint:', debugRun.config.additionalFlags?.runtimeFingerprint || 'MISSING');

// Check for FP3 marker
const hasFP3 = [
  debugRun.__fingerprint,
  debugRun.meta.generatorVersion,
  debugRun.meta.runtimeFingerprint,
  debugRun.config.additionalFlags?.runtimeFingerprint,
].some(v => v && String(v).includes('FP3'));

console.log('\n=== RESULT ===');
if (hasFP3) {
  console.log('✅ FP3 FINGERPRINT PRESENT - Patched code is running!');
} else {
  console.log('❌ FP3 FINGERPRINT MISSING - Patched code is NOT running!');
  console.log('   Run: npx convex dev --once  OR  npx convex deploy');
}

// Check plan_change section handling
console.log('\n=== PLAN_CHANGE SECTION CHECK ===');
const planChangeSections = debugRun.sections.filter(
  s => s.decisions.intentLabel === 'plan_change'
);

console.log(`Found ${planChangeSections.length} plan_change section(s)`);

for (const section of planChangeSections) {
  console.log(`\nSection ${section.sectionId}:`);
  console.log(`  - dropStage: ${section.dropStage || 'null (good)'}`);
  console.log(`  - dropReason: ${section.dropReason || 'null (good)'}`);
  console.log(`  - synthesisRan: ${section.synthesisRan}`);
  console.log(`  - emitted: ${section.emitted}`);
  console.log(`  - candidates: ${section.candidates.length}`);
  
  if (section.dropStage === 'ACTIONABILITY') {
    console.log('  ❌ INVARIANT VIOLATION: plan_change dropped at ACTIONABILITY!');
  }
  if (section.dropStage === 'THRESHOLD') {
    console.log('  ❌ INVARIANT VIOLATION: plan_change dropped at THRESHOLD!');
  }
  
  for (const candidate of section.candidates) {
    console.log(`  Candidate ${candidate.candidateId}: emitted=${candidate.emitted}, dropStage=${candidate.dropStage || 'null'}`);
    if (candidate.metadata?.type === 'plan_mutation' && candidate.dropStage === 'THRESHOLD') {
      console.log('    ❌ INVARIANT VIOLATION: plan_mutation candidate dropped at THRESHOLD!');
    }
  }
}

// Output suggestions
console.log('\n=== SUGGESTIONS EMITTED ===');
console.log(`Total: ${result.suggestions.length}`);
for (const s of result.suggestions) {
  console.log(`  - ${s.suggestion_id}: type=${s.type}, needsClarification=${s.needs_clarification}, highConfidence=${s.is_high_confidence}`);
}

// Output full JSON for inspection
console.log('\n=== FULL DEBUG JSON (for inspection) ===');
console.log(JSON.stringify(debugRun, null, 2));
