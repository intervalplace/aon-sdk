import type { AonObject } from "../object.js";

export type ValidationGraph = {
  objects: AonObject[];
  byHash?: Record<string, AonObject>;
};

function lower(hash: string) {
  return hash.toLowerCase();
}

export function objectByHash(graph: ValidationGraph, hash: string) {
  const h = lower(hash);

  if (graph.byHash?.[h]) return graph.byHash[h];

  return (
    graph.objects.find(
      (o) => o.objectHash?.toLowerCase() === h
    ) ?? null
  );
}

export function requireObject(
  graph: ValidationGraph,
  hash: string,
  expectedType?: string
): AonObject {
  const obj = objectByHash(graph, hash);

  if (!obj) {
    throw new Error("REFERENCED_OBJECT_NOT_FOUND");
  }

  if (expectedType && obj.objectType !== expectedType) {
    throw new Error("INVALID_REFERENCE_TYPE");
  }

  return obj;
}

export function requireNamespace(expected: string, actual: string) {
  if (expected !== actual) {
    throw new Error("NAMESPACE_MISMATCH");
  }
}

export function requireReferenceCount(obj: AonObject, count: number) {
  if ((obj.references ?? []).length !== count) {
    throw new Error("INVALID_REFERENCE_COUNT");
  }
}

export function requireReferenceTypes(
  graph: ValidationGraph,
  obj: AonObject,
  expected: string[]
) {
  requireReferenceCount(obj, expected.length);

  return expected.map((type, i) =>
    requireObject(graph, obj.references[i], type)
  );
}
