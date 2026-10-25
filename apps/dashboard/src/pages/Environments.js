import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useUi } from "../store";
import { ErrorBox, Loading, Pill } from "../components/Status";
export function Environments() {
    const tick = useUi((s) => s.refreshToken);
    const envs = useQuery({ queryKey: ["environments", tick], queryFn: () => api.environments() });
    if (envs.isPending)
        return _jsx(Loading, {});
    if (envs.isError)
        return _jsx(ErrorBox, { message: envs.error.message, onRetry: () => envs.refetch() });
    return (_jsxs("div", { className: "grid", style: { gap: 16 }, children: [_jsx("h2", { style: { margin: 0 }, children: "Environments" }), envs.data.items.map((e) => (_jsxs("div", { className: "card", children: [_jsxs("h3", { children: [e.environment, " \u2014 ", _jsx(Pill, { value: e.status })] }), e.lastDeployment ? (_jsxs("p", { children: ["Last: ", e.lastDeployment.status, " \u00B7 ", e.lastDeployment.artifactDigest.slice(0, 20), "\u2026 \u00B7 approvals: ", e.lastDeployment.approvals.length, " \u00B7 rollback ", e.lastDeployment.rollbackAvailable ? "available" : "unavailable"] })) : _jsx("p", { className: "muted", children: "Never deployed. Local compose profiles simulate per-env behavior; real staging/production use protected GitLab environments." })] }, e.environment)))] }));
}
//# sourceMappingURL=Environments.js.map