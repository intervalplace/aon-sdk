import { keccak256, toBytes } from "viem";

export type AonObject = {
  objectType: string;
  schemaVersion: string;
  namespace: string;
  createdAt: number;
  references: string[];
  payload?: Record<string, unknown>;
  objectHash?: string;
  signature?: any;
};

export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined && k !== "objectHash")
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashObject(obj: AonObject): string {
  return keccak256(toBytes(canonicalize(obj)));
}

export function finalizeObject(obj: AonObject): AonObject {
  return { ...obj, objectHash: hashObject(obj) };
}
