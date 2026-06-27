# AON SDK

The executor and namespace layer for the Authorization Object Network.

The SDK contains everything that runs *on top of* AON nodes — namespace adapters, graph evaluation, object construction, execution logic, and query helpers. It has no p2p logic, no storage, and no server. It communicates with the network exclusively through the node HTTP API.

## Architecture

```
src/
  index.ts                   — Public SDK surface (all exports)
  client.ts                  — HTTP client for AON nodes
  object.ts                  — AonObject type
  executor.ts                — Permissionless executor loop
  executable.ts              — Graph evaluation (csd-usdc)
  executableEvmSpot.ts       — Graph evaluation (evm-spot)
  helpers.ts                 — Query, construction, and verification helpers
  namespaces/
    index.ts                 — Namespace adapters (csdUsdcAdapter, evmSpotAdapter)
    evm-spot/evaluate.ts     — EVM spot evaluation logic
  executors/
    evmCsdUsdcSettlement.ts  — CSD/USDC on-chain settlement
    evmSpotSettlement.ts     — EVM spot on-chain settlement
  proofs/
    csdFromTxid.ts           — CSD payment proof construction
  validators/                — Semantic object validation
  verifiers/                 — Signature and proof verification
  contracts/
    CsdUsdcSettlement.sol    — CSD/USDC settlement contract
    GenericEvmSpotSettlement.sol — EVM spot settlement contract
  utils/canonical.ts

scripts/                     — Example executor scripts
  testEvmSpotObjects.mjs
  testExecutorAuto.mjs
  testReserveFlow.mjs
  testSignedCsdAuth.mjs
```

## Concepts

**Executors** are permissionless participants that discover executable authorization graphs on the network and consume them. Anyone can run an executor against any AON node. No registration, no node operator permission, no prior coordination required.

**Namespace adapters** define how a specific namespace interprets objects — what valid authorization looks like, how to verify proofs, how to execute, and what the executor reward is. The SDK ships with two adapters: `aon:csd-usdc` and `aon:evm-spot`.

**Helpers** are pure functions over `AonObject[]` arrays. They cover every query and construction operation that executors need — filtering, enrichment, object building, signature verification.

## Running an executor

```ts
import { runExecutor } from "aon-sdk";

await runExecutor({
  nodeUrl: "http://localhost:8787",
  namespace: "aon:evm-spot",
  mode: "contract",       // "contract" | "simulate" | "off"
  pollIntervalMs: 5000,
  onExecuted: (graph, result) => console.log("executed", result),
  onError: (graph, err) => console.error("failed", err),
});
```

The executor polls the node, finds executable graphs in the given namespace, verifies them, executes, and submits Receipt Objects back to the node via `POST /v1/objects`.

## Node client

```ts
import { AonNodeClient } from "aon-sdk";

const client = new AonNodeClient("http://localhost:8787");

// Fetch a single object
const obj = await client.getObject("0xabc...");

// Submit an object
await client.putObject(myObject);

// List objects with filters
const objects = await client.listObjects({ namespace: "aon:evm-spot" });

// Walk the inbound graph from a root hash
const graph = await client.walkGraph("0xabc...");

// Get assembled graph
const graph = await client.getGraph("0xabc...");
```

## Query helpers

All helpers take an `AonObject[]` array fetched from a node. They are pure functions — no network calls, no storage.

```ts
import {
  findExecutable,
  findNextExecutable,
  openAuthorizations,
  openReserves,
  expiredReserves,
  receipts,
  receiptsByReserve,
  receiptsByProof,
  receiptsByTxid,
  canonicalReceiptByReserve,
  canonicalReceiptByTxid,
  isRevoked,
  revocationsForTarget,
  listNamespaces,
} from "aon-sdk";

const objects = await client.listObjects();

// Find all executable graphs in a namespace
const executable = findExecutable(objects, { namespace: "aon:evm-spot" });

// Find the next executable graph
const next = findNextExecutable(objects, "aon:csd-usdc");

// Open authorizations (no reserve yet, not expired, not revoked)
const auths = openAuthorizations(objects, "aon:csd-usdc");

// Open reserves (no receipt yet)
const reserves = openReserves(objects, "aon:csd-usdc");

// Expired reserves eligible for refund
const expired = expiredReserves(objects, "aon:csd-usdc");

// Receipt queries
const allReceipts = receipts(objects, { namespace: "aon:csd-usdc" });
const byReserve = receiptsByReserve(objects, reserveHash);
const byProof = receiptsByProof(objects, proofHash);
const byTxid = receiptsByTxid(objects, txid);
const { canonical, duplicateCount } = canonicalReceiptByReserve(objects, reserveHash);

// Revocations
const revoked = isRevoked(objects, authHash);
const revocations = revocationsForTarget(objects, authHash);

// List registered namespace adapters
const namespaces = listNamespaces();
```

## Object construction helpers

Build and verify authorization objects before submitting them to a node.

```ts
import {
  buildCsdUsdcAuthorizationObject,
  buildEvmSpotAuthorizationObject,
  buildEvmSpotOrderObject,
  buildEvmSpotFillObject,
  buildRevocationObject,
  buildReceiptObject,
  makeCsdPaymentProofObject,
} from "aon-sdk";

// Build a CSD/USDC authorization from an EIP-712 signed payload
const authObj = await buildCsdUsdcAuthorizationObject({
  authorization: { buyer, sellerUsdcRecipient, ... },
  signature: "0x...",
  domain: { name: "AON", chainId: 1, verifyingContract: "0x..." },
});

// Build an EVM spot trading session authorization
const authObj = await buildEvmSpotAuthorizationObject({
  authorization: { grantor, settlementContract, ... },
  signature: "0x...",
  domain: { ... },
});

// Build an EVM spot order
const orderObj = await buildEvmSpotOrderObject({
  authorizationHash: "0xabc...",
  authorization: authObject,
  order: { trader, marketId, side, price, baseAmount, ... },
  signature: "0x...",
  domain: { ... },
});

// Build an EVM spot fill (matcher role)
const fillObj = buildEvmSpotFillObject({
  makerAuthorizationHash: "0x...",
  takerAuthorizationHash: "0x...",
  makerOrderHash: "0x...",
  takerOrderHash: "0x...",
  fill: { price, baseAmount, quoteAmount, fillNonce, ... },
});

// Build a CSD payment proof from a transaction ID
const proofObj = await makeCsdPaymentProofObject({
  reserveHash: "0x...",
  txid: "abc123...",
  expectedRecipientScriptPubKey: "0x...",
  expectedAmount: "1000000",
  minConfirmations: 3,
});

// Build a revocation
const revocationObj = await buildRevocationObject(objects, {
  targetHash: "0x...",
  signature: { signature: "0x...", domain: { ... }, ... },
  reason: "user_revoked",
  nonce: "0x...",
});
```

## Namespace adapters

```ts
import { getNamespaceAdapter, csdUsdcAdapter, evmSpotAdapter } from "aon-sdk";

const adapter = getNamespaceAdapter("aon:evm-spot");

// Summarize an authorization for display
const summary = adapter.summarizeAuthorization(authObject);

// Get the executor reward for a graph
const reward = adapter.reward(graph);

// Verify a graph before execution
const result = adapter.verify(graph);

// Execute a graph
const result = await adapter.execute({ ...graph, mode: "contract" });
```

## Namespaces

### `aon:csd-usdc`
Coordinates settlement between CSD (a custom settlement layer) and USDC on EVM. Flow: authorization → reserve (USDC lock on-chain) → proof (CSD payment txid) → receipt (USDC released to seller).

### `aon:evm-spot`
Coordinates spot trading on EVM. Flow: maker authorization + taker authorization → maker order + taker order → fill → receipt (settled on-chain via settlement contract).

## Adding a namespace

Implement the `NamespaceAdapter` interface and register it:

```ts
import type { NamespaceAdapter } from "aon-sdk";

const myAdapter: NamespaceAdapter = {
  namespace: "aon:my-namespace",
  authorizationType: "my_auth",
  reserveType: "my_reserve",
  proofType: "my_proof",

  normalizeAuthorization(auth) { ... },
  types() { ... },
  summarizeAuthorization(auth) { ... },
  reward(graph) { ... },
  verify(graph) { ... },
  async execute(graph) { ... },
  async lock({ authorization }) { ... },
};
```

## Node

The AON node that the SDK connects to lives in [aon](https://github.com/intervalplace/aon). The node is transport-agnostic infrastructure — it propagates objects without understanding their contents. The SDK is the layer that gives those objects meaning.
