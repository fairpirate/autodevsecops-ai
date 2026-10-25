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
] as const;

export function App() {
  const bump = useUi((s) => s.bump);
  return (
    <div className="shell">
      <nav className="nav" aria-label="Primary">
        <div className="brand">
          AutoDevSecOps AI<small>Review. Repair. Verify. Test. Deploy.</small>
        </div>
        {LINKS.map(([label, to]) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
            {label}
          </NavLink>
        ))}
        <button type="button" className="ghost" style={{ marginTop: "auto" }} onClick={bump}>
          Refresh
        </button>
      </nav>
      <main className="main">
        <ApiKeyGate />
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:id" element={<RunDetail />} />
          <Route path="/issues" element={<Issues />} />
          <Route path="/issues/:id" element={<IssueDetail />} />
          <Route path="/repairs" element={<Repairs />} />
          <Route path="/tests" element={<TestResults />} />
          <Route path="/environments" element={<Environments />} />
          <Route path="/deployments" element={<Deployments />} />
          <Route path="/policies" element={<Policies />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
