/**
 * AON Full Test Suite
 *
 * Tests the complete flow end to end against a running AON node.
 * Uses the SDK helpers directly — no server endpoints, just the node HTTP API.
 *
 * Usage:
 *   node test.mjs                          # runs against http://localhost:8787
 *   AON_URL=http://1.2.3.4:8787 node test.mjs
 *
 * Requirements:
 *   - AON node running and reachable
 *   - npm install viem (in the same directory, or use the SDK)
 */

import { privateKeyToAccount } from "viem/accounts";
import {
  buildEvmSpotAuthorizationObject,
  buildEvmSpotOrderObject,
  buildEvmSpotFillObject,
  buildRevocationObject,
  findExecutableEvmSpotGraphs,
  findExecutable,
  isRevoked,
  revocationsForTarget,
  hasReceiptReferencing,
  openReserves,
  receipts,
  receiptsByReserve,
  canonicalReceiptByReserve,
  listNamespaces,
  AonNodeClient,
} from "./src/index.ts";

// ── Config ────────────────────────────────────────────────────────────────────

const AON_URL = process.env.AON_URL ?? "http://127.0.0.1:8787";
const client = new AonNodeClient(AON_URL);

const SETTLEMENT_CONTRACT =
  process.env.AON_EVM_SPOT_SETTLEMENT_CONTRACT ??
  "0x0000000000000000000000000000000000000009";

const BASE_TOKEN   = "0x0000000000000000000000000000000000000010";
const QUOTE_TOKEN  = "0x0000000000000000000000000000000000000020";
const MARKET_ID    = `0x${"aa".repeat(32)}`;

// Fixed test keys — never use on mainnet
const MAKER = privateKeyToAccount(
  "0x4019e96887def59e26a0929378394432f1b3986f42029269720f249943bf5fb5"
);
const TAKER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044976f3f0345ba5f489568411dc3b6c52f14f3e541f8f"
);

function hex32(byte) {
  return `0x${byte.repeat(32)}`;
}

const DOMAIN = {
  name: "AON EVM Spot",
  version: "1",
  chainId: 1,
  verifyingContract: SETTLEMENT_CONTRACT,
};

const AUTH_TYPES = {
  TradingSessionAuthorization: [
    { name: "grantor",              type: "address" },
    { name: "settlementContract",   type: "address" },
    { name: "baseToken",            type: "address" },
    { name: "quoteToken",           type: "address" },
    { name: "marketId",             type: "bytes32" },
    { name: "sideMask",             type: "uint8"   },
    { name: "maxBaseExposure",      type: "uint256" },
    { name: "maxQuoteExposure",     type: "uint256" },
    { name: "maxExecutorFeeQuote",  type: "uint256" },
    { name: "minPrice",             type: "uint256" },
    { name: "maxPrice",             type: "uint256" },
    { name: "validAfter",           type: "uint64"  },
    { name: "validBefore",          type: "uint64"  },
    { name: "authNonce",            type: "bytes32" },
  ],
};

const ORDER_TYPES = {
  SignedOrder: [
    { name: "trader",          type: "address" },
    { name: "marketId",        type: "bytes32" },
    { name: "side",            type: "uint8"   },
    { name: "price",           type: "uint256" },
    { name: "baseAmount",      type: "uint256" },
    { name: "orderNonce",      type: "bytes32" },
    { name: "sessionAuthHash", type: "bytes32" },
    { name: "validAfter",      type: "uint64"  },
    { name: "validBefore",     type: "uint64"  },
  ],
};

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

function section(name) {
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 60 - name.length))}`);
}

// ── Shared state (populated as tests run) ────────────────────────────────────

let makerAuthObj, takerAuthObj;
let makerOrderObj, takerOrderObj;
let fillObj1, fillObj2;
let receiptObj;
let revocationObj;

// ── 1. Node health ────────────────────────────────────────────────────────────

section("Node");

await test("health check responds ok", async () => {
  const res = await fetch(`${AON_URL}/v1/health`);
  const json = await res.json();
  assert(json.ok === true, `expected ok=true, got ${JSON.stringify(json)}`);
});

await test("p2p info responds", async () => {
  const res = await fetch(`${AON_URL}/v1/p2p/info`);
  const json = await res.json();
  assert(json.ok === true, "p2p info not ok");
  assert(typeof json.p2p === "object", "no p2p field");
});

await test("objects list responds", async () => {
  const objects = await client.listObjects();
  assert(Array.isArray(objects), "expected array");
});

await test("namespace listing works", async () => {
  const ns = listNamespaces();
  assert(Array.isArray(ns), "expected array");
  assert(ns.some((n) => n.namespace === "aon:evm-spot"), "aon:evm-spot missing");
  assert(ns.some((n) => n.namespace === "aon:csd-usdc"), "aon:csd-usdc missing");
});

// ── 2. Object construction and submission ─────────────────────────────────────

section("Object construction — EVM Spot authorizations");

const now = Math.floor(Date.now() / 1000);

const makerAuthData = {
  grantor:             MAKER.address,
  settlementContract:  SETTLEMENT_CONTRACT,
  baseToken:           BASE_TOKEN,
  quoteToken:          QUOTE_TOKEN,
  marketId:            MARKET_ID,
  sideMask:            2,
  maxBaseExposure:     "1000000000000000000",
  maxQuoteExposure:    "0",
  maxExecutorFeeQuote: "1000000000000000",
  minPrice:            "1000000000000000000",
  maxPrice:            "1000000000000000000",
  validAfter:          String(now - 60),
  validBefore:         String(now + 3600),
  authNonce:           hex32("bb"),
};

const takerAuthData = {
  grantor:             TAKER.address,
  settlementContract:  SETTLEMENT_CONTRACT,
  baseToken:           BASE_TOKEN,
  quoteToken:          QUOTE_TOKEN,
  marketId:            MARKET_ID,
  sideMask:            1,
  maxBaseExposure:     "0",
  maxQuoteExposure:    "1000000000000000000",
  maxExecutorFeeQuote: "1000000000000000",
  minPrice:            "1000000000000000000",
  maxPrice:            "1000000000000000000",
  validAfter:          String(now - 60),
  validBefore:         String(now + 3600),
  authNonce:           hex32("cc"),
};

await test("builds maker authorization object from signed data", async () => {
  const sig = await MAKER.signTypedData({
    domain: DOMAIN,
    types: AUTH_TYPES,
    primaryType: "TradingSessionAuthorization",
    message: makerAuthData,
  });

  makerAuthObj = await buildEvmSpotAuthorizationObject({
    authorization: makerAuthData,
    signature: sig,
    signer: MAKER.address,
    domain: DOMAIN,
    types: AUTH_TYPES,
  });

  assert(makerAuthObj.objectType === "authorization", "wrong objectType");
  assert(makerAuthObj.namespace === "aon:evm-spot", "wrong namespace");
  assert(makerAuthObj.payload?.authorizationType === "evm_spot_session", "wrong authorizationType");
  assert(typeof makerAuthObj.objectHash === "string", "no objectHash");
});

await test("builds taker authorization object from signed data", async () => {
  const sig = await TAKER.signTypedData({
    domain: DOMAIN,
    types: AUTH_TYPES,
    primaryType: "TradingSessionAuthorization",
    message: takerAuthData,
  });

  takerAuthObj = await buildEvmSpotAuthorizationObject({
    authorization: takerAuthData,
    signature: sig,
    signer: TAKER.address,
    domain: DOMAIN,
    types: AUTH_TYPES,
  });

  assert(takerAuthObj.objectType === "authorization", "wrong objectType");
  assert(takerAuthObj.objectHash !== makerAuthObj.objectHash, "maker and taker have same hash");
});

await test("rejects authorization with wrong signer", async () => {
  const sig = await TAKER.signTypedData({
    domain: DOMAIN,
    types: AUTH_TYPES,
    primaryType: "TradingSessionAuthorization",
    message: makerAuthData,
  });

  let threw = false;
  try {
    await buildEvmSpotAuthorizationObject({
      authorization: makerAuthData,
      signature: sig,
      signer: MAKER.address, // TAKER signed but MAKER is expected
      domain: DOMAIN,
      types: AUTH_TYPES,
    });
  } catch {
    threw = true;
  }

  assert(threw, "should have thrown for wrong signer");
});

await test("submits maker authorization to node", async () => {
  const result = await client.putObject(makerAuthObj);
  assert(result.ok === true, `put failed: ${JSON.stringify(result)}`);
  assert(result.objectHash === makerAuthObj.objectHash, "hash mismatch on put");
});

await test("submits taker authorization to node", async () => {
  const result = await client.putObject(takerAuthObj);
  assert(result.ok === true, `put failed: ${JSON.stringify(result)}`);
});

await test("fetches authorization back from node by hash", async () => {
  const obj = await client.getObject(makerAuthObj.objectHash);
  assert(obj !== null, "object not found");
  assert(obj.objectHash === makerAuthObj.objectHash, "hash mismatch on fetch");
  assert(obj.objectType === "authorization", "wrong objectType on fetch");
});

await test("idempotent — submitting same object twice does not fail", async () => {
  const result = await client.putObject(makerAuthObj);
  assert(result.ok === true, "second put failed");
});

// ── 3. Order construction ─────────────────────────────────────────────────────

section("Object construction — EVM Spot orders");

const makerOrderData = {
  trader:          MAKER.address,
  marketId:        MARKET_ID,
  side:            0,
  price:           "1000000000000000000",
  baseAmount:      "1000000000000000000",
  orderNonce:      hex32("dd"),
  sessionAuthHash: makerAuthObj.objectHash,
  validAfter:      String(now - 60),
  validBefore:     String(now + 3600),
};

const takerOrderData = {
  trader:          TAKER.address,
  marketId:        MARKET_ID,
  side:            1,
  price:           "1000000000000000000",
  baseAmount:      "1000000000000000000",
  orderNonce:      hex32("ee"),
  sessionAuthHash: takerAuthObj.objectHash,
  validAfter:      String(now - 60),
  validBefore:     String(now + 3600),
};

await test("builds maker order object from signed data", async () => {
  const sig = await MAKER.signTypedData({
    domain: DOMAIN,
    types: ORDER_TYPES,
    primaryType: "SignedOrder",
    message: makerOrderData,
  });

  makerOrderObj = await buildEvmSpotOrderObject({
    authorizationHash: makerAuthObj.objectHash,
    authorization: makerAuthObj,
    order: makerOrderData,
    signature: sig,
    signer: MAKER.address,
    domain: DOMAIN,
    types: ORDER_TYPES,
  });

  assert(makerOrderObj.objectType === "order", "wrong objectType");
  assert(makerOrderObj.namespace === "aon:evm-spot", "wrong namespace");
  assert(makerOrderObj.references.includes(makerAuthObj.objectHash.toLowerCase()), "auth hash not in references");
});

await test("builds taker order object from signed data", async () => {
  const sig = await TAKER.signTypedData({
    domain: DOMAIN,
    types: ORDER_TYPES,
    primaryType: "SignedOrder",
    message: takerOrderData,
  });

  takerOrderObj = await buildEvmSpotOrderObject({
    authorizationHash: takerAuthObj.objectHash,
    authorization: takerAuthObj,
    order: takerOrderData,
    signature: sig,
    signer: TAKER.address,
    domain: DOMAIN,
    types: ORDER_TYPES,
  });

  assert(takerOrderObj.objectType === "order", "wrong objectType");
});

await test("rejects order where sessionAuthHash does not match authorizationHash", async () => {
  const badOrderData = {
    ...makerOrderData,
    sessionAuthHash: hex32("ff"), // wrong hash
  };

  const sig = await MAKER.signTypedData({
    domain: DOMAIN,
    types: ORDER_TYPES,
    primaryType: "SignedOrder",
    message: badOrderData,
  });

  let threw = false;
  try {
    await buildEvmSpotOrderObject({
      authorizationHash: makerAuthObj.objectHash,
      authorization: makerAuthObj,
      order: badOrderData,
      signature: sig,
      signer: MAKER.address,
      domain: DOMAIN,
      types: ORDER_TYPES,
    });
  } catch {
    threw = true;
  }

  assert(threw, "should have thrown for auth hash mismatch");
});

await test("submits maker order to node", async () => {
  const result = await client.putObject(makerOrderObj);
  assert(result.ok === true, `put failed: ${JSON.stringify(result)}`);
});

await test("submits taker order to node", async () => {
  const result = await client.putObject(takerOrderObj);
  assert(result.ok === true, `put failed: ${JSON.stringify(result)}`);
});

// ── 4. Fill construction ──────────────────────────────────────────────────────

section("Object construction — EVM Spot fills");

await test("builds first partial fill object", async () => {
  fillObj1 = buildEvmSpotFillObject({
    makerAuthorizationHash: makerAuthObj.objectHash,
    takerAuthorizationHash: takerAuthObj.objectHash,
    makerOrderHash: makerOrderObj.objectHash,
    takerOrderHash: takerOrderObj.objectHash,
    fill: {
      price:                  "1000000000000000000",
      baseAmount:             "400000000000000000",
      quoteAmount:            "400000000000000000",
      executorFeeQuoteAmount: "100000000000000",
      fillNonce:              hex32("f1"),
      settlementContract:     SETTLEMENT_CONTRACT,
    },
  });

  assert(fillObj1.objectType === "fill", "wrong objectType");
  assert(fillObj1.namespace === "aon:evm-spot", "wrong namespace");
  assert(fillObj1.references.length === 4, "should have 4 references");
  assert(fillObj1.payload.fillType === "evm_spot_fill", "wrong fillType");
});

await test("builds second partial fill object with different nonce", async () => {
  fillObj2 = buildEvmSpotFillObject({
    makerAuthorizationHash: makerAuthObj.objectHash,
    takerAuthorizationHash: takerAuthObj.objectHash,
    makerOrderHash: makerOrderObj.objectHash,
    takerOrderHash: takerOrderObj.objectHash,
    fill: {
      price:                  "1000000000000000000",
      baseAmount:             "600000000000000000",
      quoteAmount:            "600000000000000000",
      executorFeeQuoteAmount: "100000000000000",
      fillNonce:              hex32("f2"),
      settlementContract:     SETTLEMENT_CONTRACT,
    },
  });

  assert(fillObj2.objectHash !== fillObj1.objectHash, "fills should have different hashes");
});

await test("submits first fill to node", async () => {
  const result = await client.putObject(fillObj1);
  assert(result.ok === true, `put failed: ${JSON.stringify(result)}`);
});

await test("submits second fill to node", async () => {
  const result = await client.putObject(fillObj2);
  assert(result.ok === true, `put failed: ${JSON.stringify(result)}`);
});

// ── 5. Graph evaluation ───────────────────────────────────────────────────────

section("Graph evaluation");

await test("findExecutableEvmSpotGraphs finds both fills as executable", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const graphs = findExecutableEvmSpotGraphs(objects);

  assert(graphs.length >= 2, `expected >= 2 executable graphs, got ${graphs.length}`);
  assert(graphs.every((g) => g.status === "executable"), "all should be executable");
});

await test("findExecutable finds graphs via generic helper", async () => {
  const objects = await client.listObjects();
  const graphs = findExecutable(objects, { namespace: "aon:evm-spot" });

  assert(graphs.length >= 2, `expected >= 2 from findExecutable, got ${graphs.length}`);
});

await test("each graph has correct structure", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const graphs = findExecutableEvmSpotGraphs(objects);

  for (const g of graphs) {
    assert(g.makerAuthorization?.objectHash, "missing makerAuthorization");
    assert(g.takerAuthorization?.objectHash, "missing takerAuthorization");
    assert(g.makerOrder?.objectHash, "missing makerOrder");
    assert(g.takerOrder?.objectHash, "missing takerOrder");
    assert(g.fill?.objectHash, "missing fill");
    assert(g.partialFill, "missing partialFill summary");
  }
});

await test("graph partial fill accounting is correct for first fill", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const graphs = findExecutableEvmSpotGraphs(objects);

  const g1 = graphs.find((g) =>
    g.fill.objectHash === fillObj1.objectHash
  );

  assert(g1, "could not find graph for fill1");
  assert(
    g1.partialFill.fillBaseAmount === "400000000000000000",
    `wrong fillBaseAmount: ${g1.partialFill.fillBaseAmount}`
  );
  assert(g1.partialFill.wouldOverfillMaker === false, "fill1 should not overfill maker");
  assert(g1.partialFill.wouldOverfillTaker === false, "fill1 should not overfill taker");
});

await test("graph partial fill accounting is correct for second fill", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const graphs = findExecutableEvmSpotGraphs(objects);

  const g2 = graphs.find((g) =>
    g.fill.objectHash === fillObj2.objectHash
  );

  assert(g2, "could not find graph for fill2");
  assert(
    g2.partialFill.fillBaseAmount === "600000000000000000",
    `wrong fillBaseAmount: ${g2.partialFill.fillBaseAmount}`
  );
});

await test("walks inbound graph from maker authorization", async () => {
  const graph = await client.walkGraph(makerAuthObj.objectHash);
  assert(graph, "no graph returned");
  assert(graph.rootHash === makerAuthObj.objectHash.toLowerCase(), "wrong root");
});

await test("fetches assembled graph from maker authorization", async () => {
  const graph = await client.getGraph(makerAuthObj.objectHash);
  assert(graph, "no graph returned");
});

// ── 6. Simulate execution and receipt ────────────────────────────────────────

section("Simulate execution");

await test("simulate mode returns expected result shape", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const graphs = findExecutableEvmSpotGraphs(objects);
  const g = graphs.find((g) => g.fill.objectHash === fillObj1.objectHash);

  assert(g, "no graph found for fill1");

  const { evmSpotAdapter } = await import("./src/namespaces/index.js");
  const result = await evmSpotAdapter.execute({ ...g, mode: "simulate" });

  assert(result.executed === true, "executed should be true");
  assert(result.mode === "simulate", "wrong mode");
  assert(typeof result.executionTx === "string", "no executionTx");
  assert(result.result === "simulated_evm_spot_settlement", "wrong result string");
});

await test("off mode returns verified_only", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const graphs = findExecutableEvmSpotGraphs(objects);
  const g = graphs[0];

  const { evmSpotAdapter } = await import("./src/namespaces/index.js");
  const result = await evmSpotAdapter.execute({ ...g, mode: "off" });

  assert(result.executed === false, "executed should be false");
  assert(result.result === "verified_only", "wrong result string");
});

await test("verify returns ok for a valid graph", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const graphs = findExecutableEvmSpotGraphs(objects);
  const g = graphs[0];

  const { evmSpotAdapter } = await import("./src/namespaces/index.js");
  const verified = evmSpotAdapter.verify(g);

  assert(verified.ok === true, `verify failed: ${JSON.stringify(verified)}`);
});

// Build and submit a simulated receipt for fill1
await test("builds and submits a receipt object for fill1", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const graphs = findExecutableEvmSpotGraphs(objects);
  const g = graphs.find((g) => g.fill.objectHash === fillObj1.objectHash);

  const refs = [
    g.makerAuthorization.objectHash,
    g.takerAuthorization.objectHash,
    g.makerOrder.objectHash,
    g.takerOrder.objectHash,
    g.fill.objectHash,
  ];

  receiptObj = {
    objectType: "receipt",
    schemaVersion: "1",
    namespace: "aon:evm-spot",
    createdAt: Date.now(),
    creator: "aon-test-suite",
    references: refs,
    payload: {
      receiptType: "authorized_state_transition_completed",
      result: "simulated_evm_spot_settlement",
      executionTx: `simulated:test:${g.fill.objectHash}`,
      executor: { mode: "simulate", executed: true },
    },
  };

  const result = await client.putObject(receiptObj);
  assert(result.ok === true, `put receipt failed: ${JSON.stringify(result)}`);
  receiptObj.objectHash = result.objectHash;
});

// ── 7. Post-receipt state ─────────────────────────────────────────────────────

section("Post-receipt graph state");

await test("fill1 is now completed after receipt submission", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const all = findExecutableEvmSpotGraphs(objects, { includeCompleted: true });
  const g = all.find((g) => g.fill.objectHash === fillObj1.objectHash);

  assert(g, "graph for fill1 not found");
  assert(g.status === "completed", `expected completed, got ${g.status}`);
  assert(g.receipt?.objectHash === receiptObj.objectHash, "wrong receipt");
});

await test("fill2 is still executable", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const graphs = findExecutableEvmSpotGraphs(objects);
  const g = graphs.find((g) => g.fill.objectHash === fillObj2.objectHash);

  assert(g, "graph for fill2 not found");
  assert(g.status === "executable", `expected executable, got ${g.status}`);
});

await test("hasReceiptReferencing returns true for fill1", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const result = hasReceiptReferencing(objects, fillObj1.objectHash);
  assert(result === true, "should have receipt referencing fill1");
});

await test("hasReceiptReferencing returns false for fill2", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const result = hasReceiptReferencing(objects, fillObj2.objectHash);
  assert(result === false, "should not have receipt referencing fill2");
});

await test("receiptsByReserve finds receipt by fill reference", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const byReserve = receiptsByReserve(objects, fillObj1.objectHash);
  assert(byReserve.length >= 1, "should find at least one receipt");
});

await test("canonicalReceiptByReserve returns the earliest receipt", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const { canonical, duplicateCount } = canonicalReceiptByReserve(objects, fillObj1.objectHash);
  assert(canonical !== null, "canonical receipt should not be null");
  assert(typeof duplicateCount === "number", "duplicateCount should be a number");
});

await test("receipts() query returns submitted receipt", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const rs = receipts(objects, { namespace: "aon:evm-spot" });
  assert(rs.some((r) => r.objectHash === receiptObj.objectHash), "receipt not found in query");
});

// ── 8. Revocation ─────────────────────────────────────────────────────────────

section("Revocation");

// We'll revoke takerAuthObj as a test
const REVOCATION_NONCE = hex32("99");

const REVOCATION_TYPES = {
  AonRevocation: [
    { name: "targetHash", type: "bytes32" },
    { name: "targetType", type: "string"  },
    { name: "reason",     type: "string"  },
    { name: "nonce",      type: "bytes32" },
  ],
};

const revocationMessage = {
  targetHash: takerAuthObj.objectHash,
  targetType: "authorization",
  reason: "user_revoked",
  nonce: REVOCATION_NONCE,
};

await test("builds a revocation object for taker authorization", async () => {
  const sig = await TAKER.signTypedData({
    domain: DOMAIN,
    types: REVOCATION_TYPES,
    primaryType: "AonRevocation",
    message: revocationMessage,
  });

  const objects = await client.listObjects({ namespace: "aon:evm-spot" });

  revocationObj = await buildRevocationObject(objects, {
    targetHash: takerAuthObj.objectHash,
    signer: TAKER.address,
    reason: "user_revoked",
    nonce: REVOCATION_NONCE,
    signature: {
      scheme: "eip712",
      domain: DOMAIN,
      types: REVOCATION_TYPES,
      primaryType: "AonRevocation",
      message: revocationMessage,
      signature: sig,
    },
  });

  assert(revocationObj.objectType === "revocation", "wrong objectType");
  assert(
    revocationObj.references.includes(takerAuthObj.objectHash.toLowerCase()),
    "target hash not in references"
  );
});

await test("submits revocation to node", async () => {
  const result = await client.putObject(revocationObj);
  assert(result.ok === true, `put revocation failed: ${JSON.stringify(result)}`);
  revocationObj.objectHash = result.objectHash;
});

await test("isRevoked returns true for taker auth after revocation", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const revoked = isRevoked(objects, takerAuthObj.objectHash);
  assert(revoked === true, "should be revoked");
});

await test("revocationsForTarget returns the revocation object", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const revocations = revocationsForTarget(objects, takerAuthObj.objectHash);
  assert(revocations.length >= 1, "expected at least one revocation");
  assert(
    revocations.some((r) => r.objectHash === revocationObj.objectHash),
    "revocation not found by target"
  );
});

await test("isRevoked returns false for maker auth (not revoked)", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  const revoked = isRevoked(objects, makerAuthObj.objectHash);
  assert(revoked === false, "maker auth should not be revoked");
});

await test("prevents revoking an already-revoked object", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  let threw = false;
  try {
    await buildRevocationObject(objects, {
      targetHash: takerAuthObj.objectHash,
      signer: TAKER.address,
      reason: "duplicate",
      nonce: hex32("98"),
      signature: {
        scheme: "eip712",
        domain: DOMAIN,
        types: REVOCATION_TYPES,
        primaryType: "AonRevocation",
        message: revocationMessage,
        signature: "0x" + "00".repeat(65),
      },
    });
  } catch (err) {
    threw = err.message === "TARGET_ALREADY_REVOKED";
  }
  assert(threw, "should have thrown TARGET_ALREADY_REVOKED");
});

// ── 9. Object references ──────────────────────────────────────────────────────

section("Object references and graph traversal");

await test("inbound references for maker auth include maker order", async () => {
  const res = await fetch(`${AON_URL}/v1/objects/${makerAuthObj.objectHash}/references`);
  const json = await res.json();
  assert(json.ok === true, "references endpoint failed");
  const hashes = json.inbound.map((o) => o.objectHash);
  assert(hashes.includes(makerOrderObj.objectHash), "maker order not in inbound refs of maker auth");
});

await test("inbound references for maker order include fills", async () => {
  const res = await fetch(`${AON_URL}/v1/objects/${makerOrderObj.objectHash}/references`);
  const json = await res.json();
  assert(json.ok === true, "references endpoint failed");
  const hashes = json.inbound.map((o) => o.objectHash);
  assert(hashes.includes(fillObj1.objectHash), "fill1 not in inbound refs of maker order");
  assert(hashes.includes(fillObj2.objectHash), "fill2 not in inbound refs of maker order");
});

await test("listObjects filters by objectType correctly", async () => {
  const auths = await client.listObjects({ objectType: "authorization" });
  assert(auths.every((o) => o.objectType === "authorization"), "non-auth object returned");
  assert(auths.some((o) => o.objectHash === makerAuthObj.objectHash), "maker auth not in filtered list");
});

await test("listObjects filters by namespace correctly", async () => {
  const objects = await client.listObjects({ namespace: "aon:evm-spot" });
  assert(objects.every((o) => o.namespace === "aon:evm-spot"), "wrong namespace object returned");
});

await test("fetching nonexistent object returns null", async () => {
  const obj = await client.getObject(hex32("00"));
  assert(obj === null, "should return null for missing object");
});

// ── 10. Hash integrity ────────────────────────────────────────────────────────

section("Hash integrity");

await test("node recomputes hash on submit — payload change produces different hash", async () => {
  // The node always recomputes objectHash from content on putObject.
  // A tampered hash is silently corrected. What actually changes the stored
  // hash is changing the payload content itself.
  const modified = {
    ...makerAuthObj,
    objectHash: undefined,
    payload: { ...makerAuthObj.payload, extra: "tampered" },
  };

  const result = await client.putObject(modified);
  assert(result.ok === true, "modified object should be accepted");
  assert(
    result.objectHash !== makerAuthObj.objectHash,
    "modified payload should produce different hash"
  );
});

await test("two identical objects produce identical hashes", async () => {
  const sig = await MAKER.signTypedData({
    domain: DOMAIN,
    types: AUTH_TYPES,
    primaryType: "TradingSessionAuthorization",
    message: makerAuthData,
  });

  // Pin createdAt so both builds are truly identical
  const pinnedCreatedAt = Date.now();

  const obj1 = await buildEvmSpotAuthorizationObject({
    authorization: makerAuthData,
    signature: sig,
    signer: MAKER.address,
    domain: DOMAIN,
    types: AUTH_TYPES,
    createdAt: pinnedCreatedAt,
  });

  const obj2 = await buildEvmSpotAuthorizationObject({
    authorization: makerAuthData,
    signature: sig,
    signer: MAKER.address,
    domain: DOMAIN,
    types: AUTH_TYPES,
    createdAt: pinnedCreatedAt,
  });

  assert(obj1.objectHash === obj2.objectHash, "identical objects should produce identical hashes");
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("\n" + "─".repeat(64));
console.log(`  ${passed} passed  ${failed} failed  ${passed + failed} total`);
console.log("─".repeat(64));

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  ✗ ${f.name}`);
    console.log(`    ${f.error}`);
  }
  process.exit(1);
}
