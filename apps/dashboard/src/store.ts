import { create } from "zustand";

interface UiState {
  apiKeySet: boolean;
  refreshToken: number;
  markApiKeySet: () => void;
  bump: () => void;
}

export const useUi = create<UiState>((set) => ({
  apiKeySet: Boolean(localStorage.getItem("ads_api_key") ?? (import.meta.env.VITE_API_KEY as string | undefined)),
  refreshToken: 0,
  markApiKeySet: () => set({ apiKeySet: true }),
  bump: () => set((s) => ({ refreshToken: s.refreshToken + 1 })),
}));

export function statePill(state: string): "ok" | "bad" | "warn" | undefined {
  if (["READY_FOR_BUILD", "verified_fixed", "deployed", "healthy", "pass"].includes(state)) return "ok";
  if (["FAILED", "BLOCKED", "failed", "unhealthy", "critical"].includes(state)) return "bad";
  if (["NEEDS_HUMAN_REVIEW", "high", "degraded", "pending_approval"].includes(state)) return "warn";
  return undefined;
}
