// index.ts
//
// Public surface of the AON SDK.
//
// Executors import from here. Nothing else needs to be imported directly
// unless you're building something that requires lower-level access.

// Node client — how executors talk to nodes
export { AonNodeClient } from "./client.js";

// Core object type
export type { AonObject } from "./object.js";

// Graph evaluation — find executable authorization relationships
export { findExecutableGraphs } from "./executable.js";
export { findExecutableEvmSpotGraphs } from "./executableEvmSpot.js";

// Namespace adapters — how each namespace interprets objects
export {
  getNamespaceAdapter,
  listNamespaceAdapters,
  csdUsdcAdapter,
  evmSpotAdapter,
} from "./namespaces/index.js";
export type { NamespaceAdapter } from "./namespaces/index.js";

// Executor loop — run a permissionless executor against a node
export { runExecutor } from "./executor.js";
export type { ExecutorConfig } from "./executor.js";
