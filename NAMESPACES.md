# Building a Namespace

A namespace defines the semantic rules for a category of authorization objects. It tells the network what objects mean, how to evaluate whether execution is possible, how to verify correctness, and how to execute.

The architecture is deliberately layered:

```
Node      — propagates objects, knows nothing about meaning
SDK       — client, executor, generic helpers, knows nothing about local truths
Namespace — your package, implements NamespaceDriver, owns all local truth
```

A namespace lives in its own repo and its own npm package. It depends on `@intervalplace/aon-sdk`. The SDK has no knowledge of any namespace — namespaces plug in at runtime via `registerNamespace()`.

No SDK files are modified when you add a namespace. Ever.

---

## The NamespaceDriver interface

```ts
import type { NamespaceDriver } from "@intervalplace/aon-sdk";

type NamespaceDriver = {
  // Unique identifier, e.g. "aon:my-namespace"
  namespace: string;

  // Find executable graphs from a flat object list.
  // This is the core — you define what "executable" means for your namespace.
  evaluate: (objects: AonObject[], opts?: any) => any[];

  // Compute the executor reward for a graph
  reward?: (graph: any) => any;

  // Verify a graph is valid before execution
  verify?: (graph: any) => { ok: boolean; reason?: string };

  // Execute a graph
  // mode: "contract" = real on-chain, "simulate" = dry run, "off" = verify only
  execute?: (graph: any, args?: { mode?: "off" | "simulate" | "contract" }) => Promise<any>;

  // Optional builder capabilities — implement if your namespace
  // provides object construction helpers
  normalizeAuthorization?: (auth: any) => any;
  types?: () => any;
  orderTypes?: () => any;
  revocationTypes?: () => any;

  // Optional: validate an individual object on arrival
  validateObject?: (obj: AonObject, graph?: any) => void | Promise<void>;
};
```

---

## Step by step

### 1. Create a new repo and package

```bash
mkdir aon-namespace-my-namespace
cd aon-namespace-my-namespace
npm init
npm install @intervalplace/aon-sdk viem
```

`package.json`:
```json
{
  "name": "@yourscope/aon-namespace-my-namespace",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "dependencies": {
    "@intervalplace/aon-sdk": "^0.1.0",
    "viem": "^2.21.0"
  }
}
```

### 2. Implement the driver

```ts
// src/namespace.ts

import type { NamespaceDriver, AonObject } from "@intervalplace/aon-sdk";

export const myNamespace: NamespaceDriver = {
  namespace: "aon:my-namespace",

  evaluate(objects: AonObject[], opts?: any) {
    // Find all authorization objects in your namespace
    const authorizations = objects.filter(
      (o) => o.objectType === "authorization" && o.namespace === "aon:my-namespace"
    );

    // Find all proof objects
    const proofs = objects.filter(
      (o) => o.objectType === "proof" && o.namespace === "aon:my-namespace"
    );

    // Build executable graphs — pair each authorization with its proof
    const graphs = [];
    for (const auth of authorizations) {
      const proof = proofs.find((p) =>
        p.references.includes(auth.objectHash!.toLowerCase())
      );
      if (!proof) continue;

      const receipt = objects.find(
        (o) =>
          o.objectType === "receipt" &&
          o.references.includes(auth.objectHash!.toLowerCase())
      );

      graphs.push({
        authorization: auth,
        proof,
        receipt: receipt ?? null,
        status: receipt ? "completed" : "executable",
      });
    }

    if (opts?.includeCompleted) return graphs;
    return graphs.filter((g) => g.status === "executable");
  },

  reward(graph: any) {
    return {
      token: graph.authorization?.payload?.rewardToken,
      amount: String(graph.authorization?.payload?.rewardAmount ?? "0"),
      tokenSymbol: "TOKEN",
      decimals: 18,
    };
  },

  verify(graph: any) {
    if (!graph.authorization?.objectHash) {
      return { ok: false, reason: "MISSING_AUTHORIZATION" };
    }
    if (!graph.proof?.objectHash) {
      return { ok: false, reason: "MISSING_PROOF" };
    }
    return { ok: true };
  },

  async execute(graph: any, args?: { mode?: "off" | "simulate" | "contract" }) {
    const mode = args?.mode ?? "simulate";

    if (mode === "off") {
      return { executed: false, mode, result: "verified_only" };
    }

    if (mode === "simulate") {
      return {
        executed: true,
        mode,
        executionTx: `simulated:aon:my-namespace:${graph.authorization?.objectHash}`,
        result: "simulated_execution",
      };
    }

    if (mode === "contract") {
      // Your on-chain execution logic here
      // const tx = await myContract.execute(...);
      // return { executed: true, mode, executionTx: tx.hash, result: "executed" };
      throw new Error("CONTRACT_EXECUTION_NOT_IMPLEMENTED");
    }

    throw new Error("UNKNOWN_EXECUTOR_MODE");
  },
};
```

### 3. Export it

```ts
// src/index.ts
export { myNamespace } from "./namespace.js";
// export your builders, evaluation helpers, etc.
```

### 4. Register and run

```ts
import { registerNamespace, runExecutor } from "@intervalplace/aon-sdk";
import { myNamespace } from "@yourscope/aon-namespace-my-namespace";

registerNamespace(myNamespace);

await runExecutor({
  nodeUrl: "http://localhost:8787",
  namespace: "aon:my-namespace",
  mode: "contract",
  pollIntervalMs: 5000,
  onExecuted: (graph, result) => console.log("executed", result),
});
```

That's it. The executor polls the node, calls `myNamespace.evaluate(objects)` to find graphs, calls `verify`, calls `execute`, and submits receipts automatically. No SDK files touched.

---

## Object types

Your namespace can define any object types it needs beyond the five protocol primitives (`authorization`, `condition`, `proof`, `receipt`, `revocation`). The node stores and propagates any `objectType` string without interpretation.

For example:
- `aon:csd-usdc` defines `reserve` — a USDC lock held pending proof
- `aon:evm-spot` defines `order` and `fill` — trading parameters and proposed matches

Objects are submitted via `POST /v1/objects` on any node.

---

## Publishing authorizations

Users publish authorizations by constructing an `AonObject` and submitting it to a node:

```ts
import { AonNodeClient, finalizeObject } from "@intervalplace/aon-sdk";

const client = new AonNodeClient("http://localhost:8787");

const auth = finalizeObject({
  objectType: "authorization",
  schemaVersion: "1",
  namespace: "aon:my-namespace",
  createdAt: Date.now(),
  creator: "0xYourAddress",
  references: [],
  payload: {
    rewardToken:  "0x...",
    rewardAmount: "1000000",
    validBefore:  String(Math.floor(Date.now() / 1000) + 3600),
  },
});

await client.putObject(auth);
```

The object propagates across all connected nodes immediately. Your executor finds it on the next poll.

---

## Reference implementations

- [aon-namespace-evm-spot](https://github.com/intervalplace/aon-namespace-evm-spot) — spot trading, multiple object types, partial fills
- [aon-namespace-csd-usdc](https://github.com/intervalplace/aon-namespace-csd-usdc) — cross-system settlement, reserve/proof pattern
