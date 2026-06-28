import type { AonObject } from "../object.js";
import type { ValidationGraph } from "./graph.js";

import {
  validateAuthorization,
} from "./authorization.js";

import {
  validateOrder,
  validateOrderGraph,
} from "./order.js";

import {
  validateRevocation,
  validateRevocationGraph,
} from "./revocation.js";

import {
  validateReserve,
  validateReserveGraph,
} from "./reserve.js";

import {
  validateProof,
  validateProofGraph,
} from "./proof.js";

import {
  validateFill,
  validateFillGraph,
} from "./fill.js";

import {
  validateReceipt,
  validateReceiptGraph,
} from "./receipt.js";

export async function validateObject(obj: AonObject) {
  switch (obj.objectType) {
    case "authorization":
      await validateAuthorization(obj);
      return;

    case "order":
      await validateOrder(obj);
      return;

    case "revocation":
      await validateRevocation(obj);
      return;

    case "reserve":
      await validateReserve(obj);
      return;

    case "proof":
      await validateProof(obj);
      return;

    case "fill":
      await validateFill(obj);
      return;

    case "receipt":
      await validateReceipt(obj);
      return;

    case "namespace_manifest":
      return;

    default:
      throw new Error("UNKNOWN_OBJECT_TYPE");
  }
}

export async function validateObjectGraph(
  obj: AonObject,
  graph: ValidationGraph
) {
  switch (obj.objectType) {
    case "order":
      await validateOrderGraph(obj, graph);
      return;

    case "revocation":
      await validateRevocationGraph(obj, graph);
      return;

    case "reserve":
      await validateReserveGraph(obj, graph);
      return;

    case "proof":
      await validateProofGraph(obj, graph);
      return;

    case "fill":
      await validateFillGraph(obj, graph);
      return;

    case "receipt":
      await validateReceiptGraph(obj, graph);
      return;

    case "authorization":
      await validateAuthorization(obj);
      return;

    case "namespace_manifest":
      return;

    default:
      throw new Error("UNKNOWN_OBJECT_TYPE");
  }
}

export async function validateGraph(graph: ValidationGraph) {
  for (const obj of graph.objects) {
    await validateObjectGraph(obj, graph);
  }
}
