# AON SDK

The executor and namespace layer for the Authorization Object Network.

The SDK contains everything that runs *on top of* AON nodes: namespace adapters, graph evaluation, object construction, execution logic, and query helpers. It has no p2p logic, no storage, and no server. It communicates with the network exclusively through the node HTTP API.

## Quickstart

**Requirements:** Node.js 20+, a running AON node

```bash
git clone https://github.com/intervalplace/aon-sdk.git
cd aon-sdk
npm install
```

**Connect to a node and list objects:**

```ts
import { AonNodeClient } from "./src/index.ts";

const client = new AonNodeClient("http://localhost:8787");
const objects = await client.listObjects({ namespace: "aon:evm-spot" });
console.log(objects);
```

**Run a permissionless executor:**

```ts
import { runExecutor } from "./src/index.ts";

await runExecutor({
  nodeUrl: "http://localhost:8787",
  namespace: "aon:evm-spot",
  mode: "simulate",        // use "contract" for real execution
  pollIntervalMs: 5000,
  onExecuted: (graph, result) => console.log("executed", result),
  onError: (graph, err) => console.error("failed", err),
});
```

The executor polls the node, finds executable authorization graphs, verifies them, executes, and submits receipts back as objects. No registration required — execution is permissionless.

**Build and submit an authorization object:**

```ts
import { buildEvmSpotAuthorizationObject, AonNodeClient } from "./src/index.ts";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount("0x...");
const client  = new AonNodeClient("http://localhost:8787");

const domain = {
  name: "AON EVM Spot",
  version: "1",
  chainId: 1,
  verifyingContract: "0x...",
};

const authorization = {
  grantor:             account.address,
  settlementContract:  "0x...",
  baseToken:           "0x...",
  quoteToken:          "0x...",
  marketId:            "0x" + "aa".repeat(32),
  sideMask:            3,
  maxBaseExposure:     "1000000000000000000",
  maxQuoteExposure:    "1000000000000000000",
  maxExecutorFeeQuote: "1000000000000000",
  minPrice:            "0",
  maxPrice:            "999999999999999999999",
  validAfter:          String(Math.floor(Date.now() / 1000) - 60),
  validBefore:         String(Math.floor(Date.now() / 1000) + 3600),
  authNonce:           "0x" + "bb".repeat(32),
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

const signature = await account.signTypedData({
  domain,
  types: AUTH_TYPES,
  primaryType: "TradingSessionAuthorization",
  message: authorization,
});

const authObject = await buildEvmSpotAuthorizationObject({
  authorization,
  signature,
  signer: account.address,
  domain,
  types: AUTH_TYPES,
});

const result = await client.putObject(authObject);
console.log("submitted:", result.objectHash);
```

The object is now on the network. Any executor watching the `aon:evm-spot` namespace can discover and act on it.

**Run the full test suite against a live node:**

```bash
AON_URL=http://localhost:8787 npx tsx test.mjs
# 51 passed  0 failed  51 total
```

---

## Architecture

```
src/
  index.ts                   — Public SDK surface (all exports)
  client.ts                  — HTTP client for AON nodes
  object.ts                  — AonObject type, canonicalization, hashing
  executor.ts                — Permissionless executor loop with backoff
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

scripts/                     — Example scripts
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
  mode: "contract",
  pollIntervalMs: 5000,
  onExecuted: (graph, result) => console.log("executed", result),
  onError: (graph, err) => console.error("failed", err),
});
```

## Node client

```ts
import { AonNodeClient } from "aon-sdk";

const client = new AonNodeClient("http://localhost:8787");

const obj      = await client.getObject("0xabc...");
const objects  = await client.listObjects({ namespace: "aon:evm-spot" });
const graph    = await client.walkGraph("0xabc...");

await client.putObject(myObject);
```

## Query helpers

All helpers take an `AonObject[]` array. They are pure functions — no network calls.

```ts
import {
  findExecutable,
  findNextExecutable,
  openAuthorizations,
  openReserves,
  expiredReserves,
  receipts,
  receiptsByReserve,
  canonicalReceiptByReserve,
  isRevoked,
  revocationsForTarget,
  listNamespaces,
} from "aon-sdk";

const objects = await client.listObjects();

const executable = findExecutable(objects, { namespace: "aon:evm-spot" });
const next       = findNextExecutable(objects, "aon:csd-usdc");
const auths      = openAuthorizations(objects, "aon:csd-usdc");
const reserves   = openReserves(objects, "aon:csd-usdc");
const expired    = expiredReserves(objects, "aon:csd-usdc");
const revoked    = isRevoked(objects, authHash);

const { canonical } = canonicalReceiptByReserve(objects, reserveHash);
```

## Object construction helpers

```ts
import {
  buildEvmSpotAuthorizationObject,
  buildEvmSpotOrderObject,
  buildEvmSpotFillObject,
  buildCsdUsdcAuthorizationObject,
  buildRevocationObject,
  buildReceiptObject,
  makeCsdPaymentProofObject,
} from "aon-sdk";
```

All builders verify the signature before returning. They return a finalized `AonObject` with `objectHash` already computed — ready to submit via `client.putObject`.

## Namespaces

### `aon:csd-usdc`

Atomic settlement between CSD (a custom settlement layer) and USDC on EVM.

```
authorization → reserve (USDC lock) → proof (CSD txid) → receipt (USDC released)
```

### `aon:evm-spot`

Spot trading on EVM — no reserve step, partial fills supported.

```
makerAuth + takerAuth → makerOrder + takerOrder → fill → receipt
```

### Adding a namespace

Implement `NamespaceAdapter` and register it in `src/namespaces/index.ts`. The adapter defines authorization structure, verification, execution, and reward logic for your namespace. The protocol and node require no changes.

## Node

The AON node lives at [intervalplace/aon](https://github.com/intervalplace/aon). Run a local node for development or connect to the public bootstrap node.

## Specification

The full protocol specification is at [SPEC.md]([https://github.com/intervalplace/aon/blob/master/docs/SPEC.md](https://github.com/intervalplace/aon/blob/master/docs/spec.md)).
