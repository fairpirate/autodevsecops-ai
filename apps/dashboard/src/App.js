import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink, Route, Routes } from "react-router-dom";
import { useUi } from "./store";
import { ApiKeyGate } from "./components/ApiKeyGate";
import { Overview } from "./pages/Overview";
import { Projects } from "./pages/Projects";
import { Runs } from "./pages/Runs";
import { RunDetail } from "./pages/RunDetail";
import { Issues } from "./pages/Issues";
import { IssueDetail } from "./pages/IssueDetail";
import { Repairs } from "./pages/Repairs";
import { TestResults } from "./pages/TestResults";
import { Environments } from "./pages/Environments";
import { Deployments } from "./pages/Deployments";
import { Policies } from "./pages/Policies";
import { Settings } from "./pages/Settings";
const LINKS = [
    ["Overview", "/"],
    ["Projects", "/projects"],
    ["Review Runs", "/runs"],
    ["Issues", "/issues"],
    ["AI Repair History", "/repairs"],
    ["Test Results", "/tests"],
    ["Environments", "/environments"],
    ["Deployments", "/deployments"],
    ["Policies", "/policies"],
    ["Settings", "/settings"],
];
export function App() {
    const bump = useUi((s) => s.bump);
    return (_jsxs("div", { className: "shell", children: [_jsxs("nav", { className: "nav", "aria-label": "Primary", children: [_jsxs("div", { className: "brand", children: ["AutoDevSecOps AI", _jsx("small", { children: "Review. Repair. Verify. Test. Deploy." })] }), LINKS.map(([label, to]) => (_jsx(NavLink, { to: to, end: to === "/", className: ({ isActive }) => (isActive ? "active" : ""), children: label }, to))), _jsx("button", { type: "button", className: "ghost", style: { marginTop: "auto" }, onClick: bump, children: "Refresh" })] }), _jsxs("main", { className: "main", children: [_jsx(ApiKeyGate, {}), _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Overview, {}) }), _jsx(Route, { path: "/projects", element: _jsx(Projects, {}) }), _jsx(Route, { path: "/runs", element: _jsx(Runs, {}) }), _jsx(Route, { path: "/runs/:id", element: _jsx(RunDetail, {}) }), _jsx(Route, { path: "/issues", element: _jsx(Issues, {}) }), _jsx(Route, { path: "/issues/:id", element: _jsx(IssueDetail, {}) }), _jsx(Route, { path: "/repairs", element: _jsx(Repairs, {}) }), _jsx(Route, { path: "/tests", element: _jsx(TestResults, {}) }), _jsx(Route, { path: "/environments", element: _jsx(Environments, {}) }), _jsx(Route, { path: "/deployments", element: _jsx(Deployments, {}) }), _jsx(Route, { path: "/policies", element: _jsx(Policies, {}) }), _jsx(Route, { path: "/settings", element: _jsx(Settings, {}) })] })] })] }));
}
//# sourceMappingURL=App.js.map