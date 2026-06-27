// helpers.ts
//
// Query and construction helpers that cover the functionality previously
// handled by semantic endpoints in the node server.
//
// These are pure functions over AonObject arrays — they take objects fetched
// from a node via AonNodeClient and return filtered/enriched results.
// No server required. Executors call these directly.

import { getAddress, verifyTypedData, type Hex } from "viem";
import type { AonObject } from "./object.js";
import { finalizeObject } from "./object.js";
import { getNamespaceAdapter, listNamespaceAdapters } from "./namespaces/index.js";
import { findExecutableGraphs } from "./executable.js";
import { findExecutableEvmSpotGraphs } from "./executableEvmSpot.js";

// ── Utility helpers ───────────────────────────────────────────────────────────

export function refsLower(obj: AonObject) {
  return (obj.references ?? []).map((x) => x.toLowerCase());
}

export function requireHex(x: any, code: string): Hex {
  if (typeof x !== "string" || !x.startsWith("0x")) throw new Error(code);
  return x as Hex;
}

export function nowMs() {
  return Date.now();
}

// ── Time and revocation checks ────────────────────────────────────────────────

export function isAuthorizationTimeActive(auth: AonObject) {
  const a = (auth.payload as any)?.authorization;
  if (!a) return false;
  const now = Math.floor(Date.now() / 1000);
  const validAfter = Number(a.validAfter ?? 0);
  const validBefore = Number(a.validBefore ?? 0);
  if (Number.isFinite(validAfter) && now < validAfter) return false;
  if (Number.isFinite(validBefore) && validBefore > 0 && now > validBefore) return false;
  return true;
}

export function revocationsForTarget(objects: AonObject[], targetHash: string) {
  const h = targetHash.toLowerCase();
  return objects.filter((r) => {
    if (r.objectType !== "revocation") return false;
    return (
      refsLower(r).includes(h) ||
      (r.payload as any)?.targetHash?.toLowerCase?.() === h
    );
  });
}

export function isRevoked(objects: AonObject[], targetHash: string) {
  return revocationsForTarget(objects, targetHash).length > 0;
}

export function isAuthorizationActive(objects: AonObject[], auth: AonObject) {
  if (!auth?.objectHash) return false;
  if (!isAuthorizationTimeActive(auth)) return false;
  if (isRevoked(objects, auth.objectHash)) return false;
  return true;
}

// ── Receipt / reserve helpers ─────────────────────────────────────────────────

export function hasReceiptReferencing(objects: AonObject[], hash: string) {
  const h = hash.toLowerCase();
  return objects.some(
    (r) => r.objectType === "receipt" && refsLower(r).includes(h)
  );
}

export function hasReserveForAuthorization(objects: AonObject[], authHash: string) {
  const h = authHash.toLowerCase();
  return objects.some(
    (r) => r.objectType === "reserve" && refsLower(r).includes(h)
  );
}

// ── Graph enrichment ──────────────────────────────────────────────────────────

export function graphNamespace(graph: any) {
  return (
    graph.authorization?.namespace ??
    graph.makerAuthorization?.namespace ??
    graph.namespace
  );
}

export function graphPrimaryAuthorization(graph: any) {
  return (
    graph.authorization ??
    graph.makerAuthorization ??
    graph.takerAuthorization
  );
}

export function enrichGraph(graph: any) {
  const adapter = getNamespaceAdapter(graphNamespace(graph));
  return { ...graph, reward: adapter.reward(graph) };
}

// ── Executable graph queries ──────────────────────────────────────────────────

export function findExecutable(
  objects: AonObject[],
  opts?: { namespace?: string; includeCompleted?: boolean }
) {
  const graphs =
    opts?.namespace === "aon:evm-spot"
      ? findExecutableEvmSpotGraphs(objects, { includeCompleted: opts?.includeCompleted })
      : findExecutableGraphs(objects, opts);

  return graphs
    .filter((g: any) => {
      if (g.status !== "executable" && !opts?.includeCompleted) return false;
      const auth = graphPrimaryAuthorization(g);
      return !auth?.objectHash || !isRevoked(objects, auth.objectHash);
    })
    .map(enrichGraph);
}

export function findNextExecutable(objects: AonObject[], namespace?: string) {
  return (
    findExecutable(objects, { namespace }).find(
      (g: any) => g.status === "executable"
    ) ?? null
  );
}

// ── Open authorization / reserve / receipt queries ────────────────────────────

export function openAuthorizations(objects: AonObject[], namespace?: string) {
  return objects
    .filter((a) => a.objectType === "authorization")
    .filter((a) => !namespace || a.namespace === namespace)
    .filter((a) => (a.payload as any)?.authorizationType === "csd_usdc_release")
    .filter((a) => !hasReserveForAuthorization(objects, a.objectHash!))
    .filter((a) => isAuthorizationActive(objects, a))
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
    .map((a) => getNamespaceAdapter(a.namespace).summarizeAuthorization(a));
}

export function openReserves(objects: AonObject[], namespace?: string) {
  return objects
    .filter((r) => r.objectType === "reserve")
    .filter((r) => !namespace || r.namespace === namespace)
    .filter((r) => !hasReceiptReferencing(objects, r.objectHash!))
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
}

export function expiredReserves(objects: AonObject[], namespace?: string) {
  const now = Math.floor(Date.now() / 1000);
  return objects
    .filter((r) => r.objectType === "reserve")
    .filter((r) => !namespace || r.namespace === namespace)
    .filter((r) => !hasReceiptReferencing(objects, r.objectHash!))
    .filter((r) => {
      const lockedUntil = Number((r.payload as any)?.lockedUntil ?? 0);
      return Number.isFinite(lockedUntil) && lockedUntil > 0 && lockedUntil < now;
    })
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
}

// ── Receipt queries ───────────────────────────────────────────────────────────

export function receipts(objects: AonObject[], opts?: { namespace?: string; current?: boolean }) {
  let out = objects
    .filter((r) => r.objectType === "receipt")
    .filter((r) => !opts?.namespace || r.namespace === opts.namespace)
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));

  if (opts?.current) {
    out = out.filter((r) =>
      refsLower(r).some((h) => {
        const obj = objects.find((o) => o.objectHash?.toLowerCase() === h);
        return obj?.objectType === "reserve";
      })
    );
  }

  return out;
}

export function receiptsByReserve(objects: AonObject[], reserveHash: string) {
  const h = reserveHash.toLowerCase();
  return objects.filter(
    (r) => r.objectType === "receipt" && refsLower(r).includes(h)
  );
}

export function receiptsByProof(objects: AonObject[], proofHash: string) {
  const h = proofHash.toLowerCase();
  return objects.filter(
    (r) => r.objectType === "receipt" && refsLower(r).includes(h)
  );
}

export function receiptsByTxid(objects: AonObject[], txid: string) {
  const t = txid.toLowerCase();
  return objects.filter(
    (r) =>
      r.objectType === "receipt" &&
      (r.payload as any)?.verification?.txid?.toLowerCase?.() === t
  );
}

export function canonicalReceiptByReserve(objects: AonObject[], reserveHash: string) {
  const all = receiptsByReserve(objects, reserveHash).sort(
    (a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0)
  );
  return {
    canonical: all[0] ?? null,
    duplicateCount: Math.max(0, all.length - 1),
    allReceiptHashes: all.map((r) => r.objectHash),
  };
}

export function canonicalReceiptByTxid(objects: AonObject[], txid: string) {
  const all = receiptsByTxid(objects, txid).sort(
    (a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0)
  );
  return {
    canonical: all[0] ?? null,
    duplicateCount: Math.max(0, all.length - 1),
    allReceiptHashes: all.map((r) => r.objectHash),
  };
}

// ── Namespace listing ─────────────────────────────────────────────────────────

export function listNamespaces() {
  return listNamespaceAdapters().map((a) => ({
    namespace: a.namespace,
    authorizationType: a.authorizationType,
    reserveType: a.reserveType,
    proofType: a.proofType,
  }));
}

// ── EIP-712 signature verification ───────────────────────────────────────────

export async function requireValidTypedSignature(args: {
  domain: any;
  types: any;
  primaryType: string;
  message: any;
  signature: any;
  expectedSigner: string;
  code: string;
}) {
  const signature = requireHex(args.signature, "INVALID_SIGNATURE");
  const ok = await verifyTypedData({
    address: getAddress(args.expectedSigner),
    domain: args.domain,
    types: args.types,
    primaryType: args.primaryType as any,
    message: args.message,
    signature,
  } as any);
  if (!ok) throw new Error(args.code);
}

// ── Object construction helpers ───────────────────────────────────────────────

function revocationTypes() {
  return {
    AonRevocation: [
      { name: "targetHash", type: "bytes32" },
      { name: "targetType", type: "string" },
      { name: "reason", type: "string" },
      { name: "nonce", type: "bytes32" },
    ],
  };
}

export async function buildCsdUsdcAuthorizationObject(body: {
  authorization: any;
  signature: any;
  domain: any;
  types?: any;
  primaryType?: string;
  signer?: string;
  namespace?: string;
  createdAt?: number;
  references?: string[];
  summary?: string;
}): Promise<AonObject> {
  const adapter = getNamespaceAdapter("aon:csd-usdc");
  const authorization = adapter.normalizeAuthorization(body.authorization);
  const signer = getAddress(body.signer ?? authorization.buyer);

  if (signer.toLowerCase() !== authorization.buyer.toLowerCase()) {
    throw new Error("SIGNER_BUYER_MISMATCH");
  }

  await requireValidTypedSignature({
    domain: body.domain,
    types: body.types ?? adapter.types(),
    primaryType: body.primaryType ?? "CsdUsdcAuthorization",
    message: authorization,
    signature: body.signature,
    expectedSigner: signer,
    code: "BAD_AUTHORIZATION_SIGNATURE",
  });

  const validBefore = Number(authorization.validBefore);
  if (Number.isFinite(validBefore) && validBefore <= Math.floor(Date.now() / 1000)) {
    throw new Error("AUTHORIZATION_EXPIRED");
  }

  return finalizeObject({
    objectType: "authorization",
    schemaVersion: "1",
    namespace: body.namespace ?? "aon:csd-usdc",
    createdAt: body.createdAt ?? nowMs(),
    creator: signer,
    references: body.references ?? [],
    payload: {
      authorizationType: "csd_usdc_release",
      authorization,
      summary: body.summary ?? null,
      signature: {
        scheme: "eip712",
        signer,
        domain: body.domain,
        types: body.types ?? adapter.types(),
        primaryType: body.primaryType ?? "CsdUsdcAuthorization",
        message: authorization,
        signature: body.signature,
      },
    },
  } as any);
}

export async function buildEvmSpotAuthorizationObject(body: {
  authorization: any;
  signature: any;
  domain: any;
  types?: any;
  primaryType?: string;
  signer?: string;
  namespace?: string;
  createdAt?: number;
  references?: string[];
  summary?: string;
}): Promise<AonObject> {
  const adapter = getNamespaceAdapter("aon:evm-spot");
  const authorization = adapter.normalizeAuthorization(body.authorization);
  const signer = getAddress(body.signer ?? authorization.grantor);

  if (signer.toLowerCase() !== authorization.grantor.toLowerCase()) {
    throw new Error("SIGNER_GRANTOR_MISMATCH");
  }

  await requireValidTypedSignature({
    domain: body.domain,
    types: body.types ?? adapter.types(),
    primaryType: body.primaryType ?? "TradingSessionAuthorization",
    message: authorization,
    signature: body.signature,
    expectedSigner: signer,
    code: "BAD_AUTHORIZATION_SIGNATURE",
  });

  return finalizeObject({
    objectType: "authorization",
    schemaVersion: "1",
    namespace: body.namespace ?? "aon:evm-spot",
    createdAt: body.createdAt ?? nowMs(),
    creator: signer,
    references: body.references ?? [],
    payload: {
      authorizationType: "evm_spot_session",
      authorization,
      summary: body.summary ?? null,
      signature: {
        scheme: "eip712",
        signer,
        domain: body.domain,
        types: body.types ?? adapter.types(),
        primaryType: body.primaryType ?? "TradingSessionAuthorization",
        message: authorization,
        signature: body.signature,
      },
    },
  } as any);
}

export async function buildEvmSpotOrderObject(
  body: {
    authorizationHash: string;
    authorization: AonObject;
    order: any;
    signature: any;
    domain: any;
    types?: any;
    primaryType?: string;
    signer?: string;
    createdAt?: number;
    summary?: string;
  }
): Promise<AonObject> {
  const orderTypes = {
    SignedOrder: [
      { name: "trader", type: "address" },
      { name: "marketId", type: "bytes32" },
      { name: "side", type: "uint8" },
      { name: "price", type: "uint256" },
      { name: "baseAmount", type: "uint256" },
      { name: "orderNonce", type: "bytes32" },
      { name: "sessionAuthHash", type: "bytes32" },
      { name: "validAfter", type: "uint64" },
      { name: "validBefore", type: "uint64" },
    ],
  };

  const order = {
    trader: getAddress(body.order.trader),
    marketId: requireHex(body.order.marketId, "INVALID_MARKET_ID"),
    side: Number(body.order.side),
    price: String(body.order.price),
    baseAmount: String(body.order.baseAmount),
    orderNonce: requireHex(body.order.orderNonce, "INVALID_ORDER_NONCE"),
    sessionAuthHash: requireHex(body.order.sessionAuthHash, "INVALID_SESSION_AUTH_HASH"),
    validAfter: String(body.order.validAfter),
    validBefore: String(body.order.validBefore),
  };

  const authHash = body.authorizationHash.toLowerCase();

  if (order.sessionAuthHash.toLowerCase() !== authHash) {
    throw new Error("ORDER_AUTH_HASH_MISMATCH");
  }

  const signer = getAddress(body.signer ?? order.trader);

  if (signer.toLowerCase() !== order.trader.toLowerCase()) {
    throw new Error("SIGNER_TRADER_MISMATCH");
  }

  await requireValidTypedSignature({
    domain: body.domain,
    types: body.types ?? orderTypes,
    primaryType: body.primaryType ?? "SignedOrder",
    message: order,
    signature: body.signature,
    expectedSigner: signer,
    code: "BAD_ORDER_SIGNATURE",
  });

  return finalizeObject({
    objectType: "order",
    schemaVersion: "1",
    namespace: "aon:evm-spot",
    createdAt: body.createdAt ?? nowMs(),
    creator: signer,
    references: [authHash],
    payload: {
      orderType: "evm_spot_order",
      order,
      summary: body.summary ?? null,
      signature: {
        scheme: "eip712",
        signer,
        domain: body.domain,
        types: body.types ?? orderTypes,
        primaryType: body.primaryType ?? "SignedOrder",
        message: order,
        signature: body.signature,
      },
    },
  } as any);
}

export function buildEvmSpotFillObject(body: {
  makerAuthorizationHash: string;
  takerAuthorizationHash: string;
  makerOrderHash: string;
  takerOrderHash: string;
  fill: any;
  creator?: string;
  createdAt?: number;
  summary?: string;
}): AonObject {
  const makerAuthorizationHash = body.makerAuthorizationHash.toLowerCase();
  const takerAuthorizationHash = body.takerAuthorizationHash.toLowerCase();
  const makerOrderHash = body.makerOrderHash.toLowerCase();
  const takerOrderHash = body.takerOrderHash.toLowerCase();

  const fill = {
    makerOrderHash: requireHex(body.fill.makerOrderHash ?? makerOrderHash, "INVALID_MAKER_ORDER_HASH"),
    takerOrderHash: requireHex(body.fill.takerOrderHash ?? takerOrderHash, "INVALID_TAKER_ORDER_HASH"),
    makerAuthHash: requireHex(body.fill.makerAuthHash ?? makerAuthorizationHash, "INVALID_MAKER_AUTH_HASH"),
    takerAuthHash: requireHex(body.fill.takerAuthHash ?? takerAuthorizationHash, "INVALID_TAKER_AUTH_HASH"),
    price: String(body.fill.price),
    baseAmount: String(body.fill.baseAmount),
    quoteAmount: String(body.fill.quoteAmount),
    executorFeeQuoteAmount: String(body.fill.executorFeeQuoteAmount ?? "0"),
    fillNonce: requireHex(body.fill.fillNonce, "INVALID_FILL_NONCE"),
    settlementContract: body.fill.settlementContract,
  };

  return finalizeObject({
    objectType: "fill",
    schemaVersion: "1",
    namespace: "aon:evm-spot",
    createdAt: body.createdAt ?? nowMs(),
    creator: body.creator ?? "aon-matcher-v0",
    references: [makerAuthorizationHash, takerAuthorizationHash, makerOrderHash, takerOrderHash],
    payload: {
      fillType: "evm_spot_fill",
      fill,
      summary: body.summary ?? null,
    },
  });
}

export async function buildRevocationObject(
  objects: AonObject[],
  body: {
    targetHash: string;
    signature: any;
    signer?: string;
    reason?: string;
    nonce?: string;
    createdAt?: number;
  }
): Promise<AonObject> {
  const targetHash = body.targetHash.toLowerCase();
  const target = objects.find((o) => o.objectHash?.toLowerCase() === targetHash);

  if (!target) throw new Error("TARGET_OBJECT_NOT_FOUND");
  if (isRevoked(objects, targetHash)) throw new Error("TARGET_ALREADY_REVOKED");
  if (!body.signature?.signature) throw new Error("MISSING_REVOCATION_SIGNATURE");

  const signer =
    body.signer ??
    (target.payload as any)?.authorization?.buyer ??
    (target.payload as any)?.authorization?.grantor ??
    target.creator;

  const reason = body.reason ?? "user_revoked";
  const nonce = requireHex(
    body.nonce ?? body.signature?.message?.nonce,
    "MISSING_REVOCATION_NONCE"
  );

  const revocationMessage = { targetHash, targetType: target.objectType, reason, nonce };

  await requireValidTypedSignature({
    domain: body.signature.domain,
    types: body.signature.types ?? revocationTypes(),
    primaryType: body.signature.primaryType ?? "AonRevocation",
    message: revocationMessage,
    signature: body.signature.signature,
    expectedSigner: signer!,
    code: "BAD_REVOCATION_SIGNATURE",
  });

  return finalizeObject({
    objectType: "revocation",
    schemaVersion: "1",
    namespace: target.namespace,
    createdAt: body.createdAt ?? nowMs(),
    creator: signer,
    references: [targetHash],
    payload: {
      revocationType: `${target.objectType}_revocation`,
      targetType: target.objectType,
      targetHash,
      reason,
      nonce,
      signature: {
        scheme: body.signature.scheme ?? "eip712",
        signer,
        domain: body.signature.domain,
        types: body.signature.types ?? revocationTypes(),
        primaryType: body.signature.primaryType ?? "AonRevocation",
        message: revocationMessage,
        signature: body.signature.signature,
      },
    },
  } as any);
}

// ── Receipt construction ──────────────────────────────────────────────────────

export function buildReceiptObject(graph: any, action: any, opts?: {
  creator?: string;
  summary?: string;
}): AonObject {
  const namespace =
    graph.authorization?.namespace ??
    graph.makerAuthorization?.namespace ??
    graph.namespace;

  const adapter = getNamespaceAdapter(namespace);
  const verification = adapter.verify(graph);

  const refs = [
    graph.authorization?.objectHash,
    graph.reserve?.objectHash,
    graph.proof?.objectHash,
    graph.makerAuthorization?.objectHash,
    graph.takerAuthorization?.objectHash,
    graph.makerOrder?.objectHash,
    graph.takerOrder?.objectHash,
    graph.fill?.objectHash,
  ].filter(Boolean) as string[];

  return finalizeObject({
    objectType: "receipt",
    schemaVersion: "1",
    namespace,
    createdAt: nowMs(),
    creator: opts?.creator ?? "aon-executor-v0",
    references: refs,
    payload: {
      receiptType: "authorized_state_transition_completed",
      result: action.result,
      executionTx: action.executionTx ?? null,
      summary: opts?.summary ?? null,
      verification,
      executor: {
        mode: action.mode,
        executed: action.executed,
      },
    },
  });
}
