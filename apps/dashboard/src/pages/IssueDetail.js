import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { ErrorBox, Loading, Pill } from "../components/Status";
export function IssueDetail() {
    const { id = "" } = useParams();
    const q = useQuery({ queryKey: ["issue", id], queryFn: () => api.issue(id) });
    if (q.isPending)
        return _jsx(Loading, {});
    if (q.isError)
        return _jsx(ErrorBox, { message: q.error.message, onRetry: () => q.refetch() });
    const i = q.data.issue;
    const evidence = i.evidence ?? [];
    const history = i.history ?? [];
    const verification = i.verification;
    return (_jsxs("div", { className: "grid", style: { gap: 16 }, children: [_jsxs("div", { className: "row", children: [_jsx("h2", { style: { margin: 0 }, children: String(i.title) }), _jsx(Pill, { value: String(i.severity) }), _jsx(Pill, { value: String(i.state) })] }), _jsxs("div", { className: "grid cols-2", children: [_jsxs("div", { className: "card", children: [_jsx("h3", { children: "Location & impact" }), _jsxs("p", { children: ["File: ", i.filePath ?? "—", i.lineStart ? `:${i.lineStart}` : ""] }), _jsxs("p", { children: ["Category: ", String(i.category), " \u00B7 Blocks release: ", String(i.blocksRelease)] }), _jsx("p", { children: String(i.description ?? "") }), _jsx("h3", { children: "Remediation" }), _jsx("p", { children: String(i.suggestedRemediation ?? "—") }), _jsxs("p", { className: "muted", children: ["Verify via: ", String(i.verificationMethod ?? "—")] })] }), _jsxs("div", { className: "card", children: [_jsxs("h3", { children: ["Evidence (", evidence.length, ")"] }), _jsx("ul", { children: evidence.map((e, n) => _jsxs("li", { children: [_jsxs("strong", { children: [e.kind, ":"] }), " ", e.description] }, n)) }), _jsx("h3", { children: "Independent verification" }), verification ? (_jsxs("ul", { children: [_jsxs("li", { children: ["Reviewer: ", verification.reviewer] }), _jsxs("li", { children: ["Verdict: ", verification.verdict, " (confidence ", verification.confidence, ")"] }), (verification.evidence ?? []).map((e, n) => _jsx("li", { children: e }, n))] })) : _jsx("p", { className: "muted", children: "Not yet verified \u2014 test/scanner output is authoritative, never AI self-assessment." }), _jsx("h3", { children: "History" }), _jsx("ul", { children: history.map((h, n) => _jsxs("li", { children: [new Date(h.at).toLocaleString(), " \u2192 ", h.to, " by ", h.actor, ": ", h.reason] }, n)) })] })] })] }));
}
//# sourceMappingURL=IssueDetail.js.map