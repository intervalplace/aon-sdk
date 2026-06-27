// executor.ts
//
// A permissionless executor loop. An executor:
//   1. Connects to one or more AON nodes via HTTP
//   2. Polls for objects
//   3. Finds executable authorization graphs
//   4. Verifies and executes them
//   5. Submits Receipt Objects back to the node
//
// Execution is permissionless — anyone who can read the object graph and
// satisfy the authorization requirements can execute. No node operator
// permission is required. No registration is required.
//
// Usage:
//
//   import { runExecutor } from "aon-sdk";
//
//   await runExecutor({
//     nodeUrl: "http://localhost:8787",
//     namespace: "aon:evm-spot",
//     mode: "contract",
//     pollIntervalMs: 5000,
//   });

import { AonNodeClient } from "./client.js";
import { findExecutableGraphs } from "./executable.js";
import { findExecutableEvmSpotGraphs } from "./executableEvmSpot.js";
import { getNamespaceAdapter } from "./namespaces/index.js";
import type { AonObject } from "./object.js";

export type ExecutorConfig = {
  // URL of the AON node to connect to
  nodeUrl: string;

  // Namespace to execute in — executor only acts within its configured namespace
  namespace: string;

  // Execution mode passed to the namespace adapter
  // "contract" — submit real on-chain transactions
  // "simulate" — dry run, no real execution
  // "off"      — verify only, do not execute
  mode: "contract" | "simulate" | "off";

  // How often to poll the node for new objects (ms)
  pollIntervalMs?: number;

  // Called when execution succeeds — useful for logging or monitoring
  onExecuted?: (graph: any, result: any) => void;

  // Called when execution fails — useful for alerting
  onError?: (graph: any, error: unknown) => void;
};

async function findGraphs(objects: AonObject[], namespace: string) {
  if (namespace === "aon:evm-spot") {
    return findExecutableEvmSpotGraphs(objects);
  }
  return findExecutableGraphs(objects, { namespace });
}

async function tryExecuteGraph(
  graph: any,
  config: ExecutorConfig,
  client: AonNodeClient
) {
  const adapter = getNamespaceAdapter(config.namespace);

  // Verify the graph is valid before attempting execution
  const verified = adapter.verify(graph);
  if (!verified?.ok) {
    console.log("[executor] graph failed verification, skipping", {
      reason: verified?.reason,
    });
    return;
  }

  // Execute
  const result = await adapter.execute({ ...graph, mode: config.mode });

  console.log("[executor] executed graph", {
    namespace: config.namespace,
    mode: config.mode,
    result,
  });

  // Submit receipt back to the node as an AonObject
  if (result?.receiptObject) {
    await client.putObject(result.receiptObject);
    console.log("[executor] submitted receipt", result.receiptObject.objectHash);
  }

  config.onExecuted?.(graph, result);
}

async function pollOnce(config: ExecutorConfig, client: AonNodeClient) {
  const objects = await client.listObjects({ namespace: config.namespace });

  const graphs = await findGraphs(objects, config.namespace);

  if (graphs.length === 0) return;

  console.log(`[executor] found ${graphs.length} executable graph(s)`);

  for (const graph of graphs) {
    try {
      await tryExecuteGraph(graph, config, client);
    } catch (err) {
      console.error("[executor] execution failed", err);
      config.onError?.(graph, err);
    }
  }
}

export async function runExecutor(config: ExecutorConfig) {
  const client = new AonNodeClient(config.nodeUrl);
  const intervalMs = config.pollIntervalMs ?? 5000;

  console.log("[executor] starting", {
    nodeUrl: config.nodeUrl,
    namespace: config.namespace,
    mode: config.mode,
    pollIntervalMs: intervalMs,
  });

  // Run immediately, then on interval
  await pollOnce(config, client);

  setInterval(async () => {
    try {
      await pollOnce(config, client);
    } catch (err) {
      console.error("[executor] poll failed", err);
    }
  }, intervalMs);
}
