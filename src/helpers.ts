// helpers.ts
//
// Generic query helpers over AonObject arrays.
// These functions know nothing about specific namespaces. They work
// on the structural properties of objects (objectType, references, createdAt)
// and delegate anything semantic to the registered namespace driver.

import type { AonObject } from "./object.js";
import { getNamespace } from "./namespace-driver.js";

// ── Utility ───────────────────────────────────────────────────────────────────

export function refsLower(obj: AonObject) {
  return (obj.references ?? []).map((x) => x.toLowerCase());
}

export function nowMs() {
  return Date.now();
}

// ── Revocation ────────────────────────────────────────────────────────────────

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

export function isAuthorizationTimeActive(auth: AonObject) {
  const a = (auth.payload as any)?.authorization;
  if (!a) return false;
  const now = Math.floor(Date.now() / 1000);
  const validAfter  = Number(a.validAfter  ?? 0);
  const validBefore = Number(a.validBefore ?? 0);
  if (Number.isFinite(validAfter)  && now < validAfter)  return false;
  if (Number.isFinite(validBefore) && validBefore > 0 && now > validBefore) return false;
  return true;
}

export function isAuthorizationActive(objects: AonObject[], auth: AonObject) {
  if (!auth?.objectHash) return false;
  if (!isAuthorizationTimeActive(auth)) return false;
  if (isRevoked(objects, auth.objectHash)) return false;
  return true;
}

// ── Receipt / reserve checks ──────────────────────────────────────────────────

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

// ── Graph helpers ─────────────────────────────────────────────────────────────

export function graphNamespace(graph: any): string {
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
  const driver = getNamespace(graphNamespace(graph));
  return { ...graph, reward: driver.reward?.(graph) };
}

// ── Executable queries ────────────────────────────────────────────────────────

export function findExecutable(
  objects: AonObject[],
  opts?: { namespace?: string; includeCompleted?: boolean }
) {
  if (!opts?.namespace) return [];
  const driver = getNamespace(opts.namespace);
  const graphs = driver.evaluate(objects, { includeCompleted: opts?.includeCompleted });

  return (graphs as any[])
    .filter((g: any) => {
      if (g.status !== "executable" && !opts?.includeCompleted) return false;
      const auth = graphPrimaryAuthorization(g);
      return !auth?.objectHash || !isRevoked(objects, auth.objectHash);
    })
    .map(enrichGraph);
}

export function findNextExecutable(objects: AonObject[], namespace?: string) {
  if (!namespace) return null;
  return (
    findExecutable(objects, { namespace }).find(
      (g: any) => g.status === "executable"
    ) ?? null
  );
}

// ── Open object queries ───────────────────────────────────────────────────────

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
