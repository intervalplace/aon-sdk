// @aon/sdk
//
// The minimal, generic client layer for the Authorization Object Network.
//
// This package knows nothing about specific namespaces, local truths,
// or execution logic. It provides:
//   - The AonObject type and hashing
//   - The HTTP client for talking to nodes
//   - The NamespaceDriver interface and registry
//   - The generic executor loop
//   - Generic query helpers over object arrays
//
// To work with a specific namespace, install its package separately:
//   npm install @aon/namespace-evm-spot
//   npm install @aon/namespace-csd-usdc

// ── Core ──────────────────────────────────────────────────────────────────────

export type { AonObject } from "./object.js";
export { hashObject, finalizeObject, canonicalize } from "./object.js";

export { AonNodeClient } from "./client.js";

// ── Namespace driver interface and registry ───────────────────────────────────

export {
  registerNamespace,
  getNamespace,
  listNamespaces,
  evaluateNamespace,
} from "./namespace-driver.js";

export type {
  NamespaceDriver,
  NamespaceExecutionMode,
  NamespaceEvaluation,
} from "./namespace-driver.js";

// ── Executor ──────────────────────────────────────────────────────────────────

export { runExecutor } from "./executor.js";
export type { ExecutorConfig } from "./executor.js";

// ── Generic graph evaluation ──────────────────────────────────────────────────

export { findExecutableGraphs } from "./executable.js";

// ── Generic query helpers ─────────────────────────────────────────────────────

export {
  refsLower,
  nowMs,
  isAuthorizationTimeActive,
  isAuthorizationActive,
  isRevoked,
  revocationsForTarget,
  hasReceiptReferencing,
  hasReserveForAuthorization,
  graphNamespace,
  graphPrimaryAuthorization,
  enrichGraph,
  findExecutable,
  findNextExecutable,
  openReserves,
  expiredReserves,
  receipts,
  receiptsByReserve,
  receiptsByProof,
  receiptsByTxid,
  canonicalReceiptByReserve,
  canonicalReceiptByTxid,
} from "./helpers.js";
