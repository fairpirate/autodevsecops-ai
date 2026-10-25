import { jsx as _jsx } from "react/jsx-runtime";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "./index.css";
const client = new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5000 } },
});
export function Root() {
    return (_jsx(BrowserRouter, { children: _jsx(QueryClientProvider, { client: client, children: _jsx(App, {}) }) }));
}
//# sourceMappingURL=main.js.map