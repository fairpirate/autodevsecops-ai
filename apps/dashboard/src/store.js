import { create } from "zustand";
export const useUi = create((set) => ({
    apiKeySet: Boolean(localStorage.getItem("ads_api_key") ?? import.meta.env.VITE_API_KEY),
    refreshToken: 0,
    markApiKeySet: () => set({ apiKeySet: true }),
    bump: () => set((s) => ({ refreshToken: s.refreshToken + 1 })),
}));
export function statePill(state) {
    if (["READY_FOR_BUILD", "verified_fixed", "deployed", "healthy", "pass"].includes(state))
        return "ok";
    if (["FAILED", "BLOCKED", "failed", "unhealthy", "critical"].includes(state))
        return "bad";
    if (["NEEDS_HUMAN_REVIEW", "high", "degraded", "pending_approval"].includes(state))
        return "warn";
    return undefined;
}
//# sourceMappingURL=store.js.map