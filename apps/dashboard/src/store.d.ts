interface UiState {
    apiKeySet: boolean;
    refreshToken: number;
    markApiKeySet: () => void;
    bump: () => void;
}
export declare const useUi: import("zustand").UseBoundStore<import("zustand").StoreApi<UiState>>;
export declare function statePill(state: string): "ok" | "bad" | "warn" | undefined;
export {};
//# sourceMappingURL=store.d.ts.map