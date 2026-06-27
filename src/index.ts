// index.ts — public surface of the AON SDK

// Node client
export { AonNodeClient } from "./client.js";

// Core object type
export type { AonObject } from "./object.js";

// Graph evaluation
export { findExecutableGraphs } from "./executable.js";
export { findExecutableEvmSpotGraphs } from "./executableEvmSpot.js";

// Namespace adapters
export {
  getNamespaceAdapter,
  listNamespaceAdapters,
  csdUsdcAdapter,
  evmSpotAdapter,
} from "./namespaces/index.js";
export type { NamespaceAdapter } from "./namespaces/index.js";

// Executor loop
export { runExecutor } from "./executor.js";
export type { ExecutorConfig } from "./executor.js";

// Query and construction helpers
export {
  // Utilities
  refsLower,
  requireHex,
  nowMs,

  // Time and revocation
  isAuthorizationTimeActive,
  isAuthorizationActive,
  isRevoked,
  revocationsForTarget,

  // Receipt / reserve checks
  hasReceiptReferencing,
  hasReserveForAuthorization,

  // Graph helpers
  graphNamespace,
  graphPrimaryAuthorization,
  enrichGraph,

  // Executable queries
  findExecutable,
  findNextExecutable,

  // Open object queries
  openAuthorizations,
  openReserves,
  expiredReserves,

  // Receipt queries
  receipts,
  receiptsByReserve,
  receiptsByProof,
  receiptsByTxid,
  canonicalReceiptByReserve,
  canonicalReceiptByTxid,

  // Namespace listing
  listNamespaces,

  // EIP-712 verification
  requireValidTypedSignature,

  // Object construction
  buildCsdUsdcAuthorizationObject,
  buildEvmSpotAuthorizationObject,
  buildEvmSpotOrderObject,
  buildEvmSpotFillObject,
  buildRevocationObject,
  buildReceiptObject,
} from "./helpers.js";

// Proof construction
export { makeCsdPaymentProofObject } from "./proofs/csdFromTxid.js";
