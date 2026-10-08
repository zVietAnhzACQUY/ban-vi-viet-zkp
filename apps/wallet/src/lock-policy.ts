export const WALLET_AUTO_LOCK_MS = 5 * 60_000;

export function shouldLockWalletOnVisibility(state: DocumentVisibilityState) {
  return state === "hidden";
}
