# Building a Namespace

A namespace defines the semantic rules for a category of authorization objects. It tells the network what objects mean, how to evaluate whether execution is possible, how to verify correctness, and how to execute.

Adding a namespace requires no changes to any core SDK file. The pattern is the same as adding a transport to the node — implement an interface, register it, done.

---

## The NamespaceDriver interface

```ts
type NamespaceDriver = {
  // Unique identifier for this namespace, e.g. "aon:my-namespace"
  namespace: string;

  // Find executable graphs from a flat list of objects.
  // This is the core of your namespace — you define what "executable" means.
  evaluate: (objects: AonObject[], opts?: any) => any[];

  // Compute the executor reward for a graph (shown to executors before they act)
  reward?: (graph: any) => any;

  // Verify a graph is valid before execution
  verify?: (graph: any) => { ok: boolean; reason?: string };

  // Execute a graph
  // mode: "contract" = real execution, "simulate" = dry run, "off" = verify only
  execute?: (graph: any, args?: { mode?: "off" | "simulate" | "contract" }) => Promise<any>;

  // Optional: validate an individual object when it arrives (before storing)
  validateObject?: (obj: AonObject, graph?: any) => void | Promise<void>;
};
```

---

## Step by step

### 1. Create your namespace directory

```
src/namespaces/my-namespace/
  index.ts
```

### 2. Implement the driver

```ts
// src/namespaces/my-namespace/index.ts

import type { NamespaceDriver } from "../index.js";
import type { AonObject } from "../../object.js";

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

      // Check for existing receipt (already executed)
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
    // Return what an executor earns for executing this graph
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
    // Add your verification logic here
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
        result: "simulated_my_namespace_execution",
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

### 3. Register it

Add it to `src/namespaces/register-defaults.ts`:

```ts
import { registerNamespace } from "./index.js";
import { evmSpotNamespace } from "./evm-spot/index.js";
import { csdUsdcNamespace } from "./csd-usdc/index.js";
import { myNamespace } from "./my-namespace/index.js";  // add this

export function registerDefaultNamespaces() {
  registerNamespace(evmSpotNamespace);
  registerNamespace(csdUsdcNamespace);
  registerNamespace(myNamespace);  // add this
}
```

Or register it yourself before running an executor:

```ts
import { registerNamespace, runExecutor } from "aon-sdk";
import { myNamespace } from "./my-namespace/index.js";

registerNamespace(myNamespace);

await runExecutor({
  nodeUrl: "http://localhost:8787",
  namespace: "aon:my-namespace",
  mode: "simulate",
});
```

### 4. Run an executor

```ts
await runExecutor({
  nodeUrl: "http://localhost:8787",
  namespace: "aon:my-namespace",
  mode: "contract",
  pollIntervalMs: 5000,
  onExecuted: (graph, result) => console.log("executed", result),
});
```

That's it. The executor polls the node, calls `myNamespace.evaluate(objects)` to find graphs, calls `verify`, calls `execute`, and submits receipts automatically. No core files touched.

---

## Object types

Your namespace can define any object types it needs. The protocol only recognizes five primitives (`authorization`, `condition`, `proof`, `receipt`, `revocation`) — any additional types are namespace-defined and the node stores them without interpretation.

For example, `aon:csd-usdc` defines `reserve` as a namespace-specific type. `aon:evm-spot` defines `order` and `fill`. Your namespace can define whatever makes sense for your coordination pattern.

Objects are submitted via `POST /v1/objects` on any node — the node stores them regardless of type.

---

## Publishing authorizations

Users publish authorizations by constructing an `AonObject` and submitting it to a node:

```ts
import { AonNodeClient } from "aon-sdk";
import { finalizeObject } from "aon-sdk";

const client = new AonNodeClient("http://localhost:8787");

const auth = finalizeObject({
  objectType: "authorization",
  schemaVersion: "1",
  namespace: "aon:my-namespace",
  createdAt: Date.now(),
  creator: "0xYourAddress",
  references: [],
  payload: {
    // Your authorization payload
    rewardToken: "0x...",
    rewardAmount: "1000000",
    validBefore: String(Math.floor(Date.now() / 1000) + 3600),
    // ... whatever your namespace defines
  },
});

await client.putObject(auth);
```

The object is now propagating across all connected nodes. Your executor will find it on the next poll.

---

## Reference implementations

- `src/namespaces/evm-spot/index.ts` — spot trading, multiple object types, partial fills
- `src/namespaces/csd-usdc/index.ts` — cross-system settlement, reserve/proof pattern
