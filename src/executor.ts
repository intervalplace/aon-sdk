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
// The poll loop uses exponential backoff when the node is unreachable or
// returns errors. On success it resets to the configured pollIntervalMs.
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

import { getNamespace } from "./namespace-driver.js";
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

  // How often to poll the node for new objects (ms). Default: 5000
  pollIntervalMs?: number;

  // Backoff config when polls fail (node down, network error, etc.)
  backoff?: {
    // Initial wait after first failure (ms). Default: 1000
    initialMs?: number;
    // Multiplier applied on each successive failure. Default: 2
    factor?: number;
    // Maximum wait between retries (ms). Default: 60000
    maxMs?: number;
  };

  // Called when execution succeeds — useful for logging or monitoring
  onExecuted?: (graph: any, result: any) => void;

  // Called when a poll or execution fails — useful for alerting
  onError?: (err: unknown, context: "poll" | "execute") => void;
};

// ── Backoff state ─────────────────────────────────────────────────────────────

type BackoffState = {
  consecutiveFailures: number;
  currentDelayMs: number;
  initialMs: number;
  factor: number;
  maxMs: number;
};

function makeBackoffState(config: ExecutorConfig): BackoffState {
  return {
    consecutiveFailures: 0,
    currentDelayMs: config.backoff?.initialMs ?? 1000,
    initialMs: config.backoff?.initialMs ?? 1000,
    factor: config.backoff?.factor ?? 2,
    maxMs: config.backoff?.maxMs ?? 60_000,
  };
}

function onPollSuccess(state: BackoffState, intervalMs: number) {
  if (state.consecutiveFailures > 0) {
    console.log("[executor] node reachable again, resetting backoff");
  }
  state.consecutiveFailures = 0;
  state.currentDelayMs = state.initialMs;
  return intervalMs;
}

function onPollFailure(state: BackoffState): number {
  state.consecutiveFailures++;
  const delay = Math.min(state.currentDelayMs, state.maxMs);
  state.currentDelayMs = Math.min(state.currentDelayMs * state.factor, state.maxMs);
  console.warn(
    `[executor] poll failed (${state.consecutiveFailures} consecutive), ` +
    `retrying in ${delay}ms`
  );
  return delay;
}

// ── Execution helpers ─────────────────────────────────────────────────────────

async function tryExecuteGraph(
  graph: any,
  driver: ReturnType<typeof getNamespace>,
  config: ExecutorConfig,
  client: AonNodeClient
) {
  const verified = driver.verify?.(graph) ?? { ok: true };
  if (!verified?.ok) {
    console.log("[executor] graph failed verification, skipping", {
      reason: verified?.reason,
    });
    return;
  }

  if (!driver.execute) throw new Error("NAMESPACE_EXECUTOR_MISSING");

  const result = await driver.execute(graph, {
    mode: config.mode,
  });

  
  console.log("[executor] executed graph", {
    namespace: config.namespace,
    mode: config.mode,
    result,
  });

  if (result?.receiptObject) {
    await client.putObject(result.receiptObject);
    console.log("[executor] submitted receipt", result.receiptObject.objectHash);
  }

  config.onExecuted?.(graph, result);
}

async function pollOnce(config: ExecutorConfig, client: AonNodeClient) {
  const objects = await client.listObjects({ namespace: config.namespace });
  const driver = getNamespace(config.namespace);
  const graphs = driver.evaluate(objects);

  if (graphs.length === 0) return;

  console.log(`[executor] found ${graphs.length} executable graph(s)`);

  for (const graph of graphs) {
    try {
      await tryExecuteGraph(graph, driver, config, client);
    } catch (err) {
      console.error("[executor] execution failed", err);
      config.onError?.(err, "execute");
    }
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

export async function runExecutor(config: ExecutorConfig) {
  registerDefaultNamespaces();
  const client = new AonNodeClient(config.nodeUrl);
  const intervalMs = config.pollIntervalMs ?? 5000;
  const backoff = makeBackoffState(config);

  console.log("[executor] starting", {
    nodeUrl: config.nodeUrl,
    namespace: config.namespace,
    mode: config.mode,
    pollIntervalMs: intervalMs,
    backoff: {
      initialMs: backoff.initialMs,
      factor: backoff.factor,
      maxMs: backoff.maxMs,
    },
  });

  // Run immediately, then loop
  let nextDelayMs = intervalMs;

  const loop = async () => {
    try {
      await pollOnce(config, client);
      nextDelayMs = onPollSuccess(backoff, intervalMs);
    } catch (err) {
      config.onError?.(err, "poll");
      nextDelayMs = onPollFailure(backoff);
    }

    setTimeout(loop, nextDelayMs);
  };

  // First poll immediately, then start the loop
  try {
    await pollOnce(config, client);
    nextDelayMs = onPollSuccess(backoff, intervalMs);
  } catch (err) {
    config.onError?.(err, "poll");
    nextDelayMs = onPollFailure(backoff);
  }

  setTimeout(loop, nextDelayMs);
}
