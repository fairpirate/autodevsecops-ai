/** Executable repair entry point; implementation and I/O live in the orchestrator service. */
import { runAgentCli } from "../../services/orchestrator/src/agent-cli";

void runAgentCli("repair");
