/**
 * Centralized TypeScript types for every Plugin-dashboard API envelope.
 * Endpoint owners MUST add their envelope here so vaultApi.ts and any future
 * client (mobile, CLI) share one source of truth.
 *
 * When you add a new endpoint:
 *   1. Add the envelope interface here.
 *   2. Implement the read in src/api/vaultApi.ts using unwrapList / unwrapField.
 *   3. Add a unit test that fails when the backend returns the wrong shape
 *      (see src/hooks/useAgentManager.test.ts and src/api/vaultApi.test.ts).
 */
export * from './responseShapes'
