# @intervalplace/aon-sdk

The minimal, generic client layer for the Authorization Object Network.

This package knows nothing about specific namespaces, local truths, or execution logic. It provides the substrate that namespace packages are built on top of.

```
Node      — propagates objects, knows nothing about meaning
SDK       — client, executor, generic helpers, knows nothing about local truths
Namespace — local truth, execution logic, EIP-712 types, contract interactions
```

## Install

```bash
npm install @intervalplace/aon-sdk
```

To work with a specific namespace, install its package alongside:

```bash
npm install @intervalplace/aon-sdk @intervalplace/aon-namespace-evm-spot
npm install @intervalplace/aon-sdk @intervalplace/aon-namespace-csd-usdc
```

## Quickstart

**Connect to a node:**

```ts
import { AonNodeClient } from "@intervalplace/aon-sdk";

const client = new AonNodeClient("http://localhost:8787");
const objects = await client.listObjects({ namespace: "aon:evm-spot" });
```

**Run a permissionless executor:**

```ts
import { runExecutor, registerNamespace } from "@intervalplace/aon-sdk";
import { evmSpotNamespace } from "@intervalplace/aon-namespace-evm-spot";

registerNamespace(evmSpotNamespace);

await runExecutor({
  nodeUrl: "http://localhost:8787",
  namespace: "aon:evm-spot",
  mode: "simulate",
  pollIntervalMs: 5000,
  onExecuted: (graph, result) => console.log("executed", result),
});
```

## What's in this package

```
src/
  object.ts            — AonObject type, canonicalization, hashing
  client.ts            — HTTP client for AON nodes
  namespace-driver.ts  — NamespaceDriver interface and registry
  executor.ts          — Generic permissionless executor loop
  executable.ts        — Generic graph evaluation
  helpers.ts           — Generic query helpers over object arrays
  index.ts             — Public surface
```

## API

### AonNodeClient

```ts
const client = new AonNodeClient("http://localhost:8787");

await client.getObject("0xabc...");
await client.putObject(obj);
await client.listObjects({ namespace: "aon:evm-spot" });
await client.walkGraph("0xabc...");
await client.getGraph("0xabc...");
```

### Namespace registry

```ts
import { registerNamespace, getNamespace, listNamespaces } from "@intervalplace/aon-sdk";

registerNamespace(myNamespace);
const driver = getNamespace("aon:my-namespace");
const all = listNamespaces();
```

### Executor

```ts
import { runExecutor } from "@intervalplace/aon-sdk";

await runExecutor({
  nodeUrl: "http://localhost:8787",
  namespace: "aon:evm-spot",
  mode: "contract",         // "contract" | "simulate" | "off"
  pollIntervalMs: 5000,
  backoff: { initialMs: 1000, factor: 2, maxMs: 60000 },
  onExecuted: (graph, result) => {},
  onError: (err, context) => {},
});
```

### Generic query helpers

All helpers take an `AonObject[]` array — no network calls, pure functions.

```ts
import {
  isRevoked, revocationsForTarget,
  hasReceiptReferencing, hasReserveForAuthorization,
  findExecutable, findNextExecutable,
  openReserves, expiredReserves,
  receipts, receiptsByReserve, receiptsByProof, receiptsByTxid,
  canonicalReceiptByReserve, canonicalReceiptByTxid,
  graphNamespace, graphPrimaryAuthorization, enrichGraph,
} from "@intervalplace/aon-sdk";
```

### NamespaceDriver interface

```ts
type NamespaceDriver = {
  namespace: string;
  evaluate: (objects: AonObject[], opts?: any) => any[];
  reward?: (graph: any) => any;
  verify?: (graph: any) => { ok: boolean; reason?: string };
  execute?: (graph: any, args?: { mode?: "off" | "simulate" | "contract" }) => Promise<any>;
  normalizeAuthorization?: (auth: any) => any;
  types?: () => any;
  orderTypes?: () => any;
  revocationTypes?: () => any;
  validateObject?: (obj: AonObject, graph?: any) => void | Promise<void>;
};
```

## Building a namespace

See [NAMESPACES.md](./NAMESPACES.md) for the full guide. The short version:

1. Create a new repo
2. Implement `NamespaceDriver`
3. Register with `registerNamespace()`
4. Done — the executor and all helpers work automatically

## Node

The AON node lives at [intervalplace/aon](https://github.com/intervalplace/aon).

## Specification

[SPEC.md](https://github.com/intervalplace/aon/blob/master/docs/spec.md)
