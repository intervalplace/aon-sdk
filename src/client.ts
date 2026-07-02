// client.ts
//
// HTTP client for talking to an AON node.
// Executors use this to read objects and submit receipts.
// The node API is the only interface between executors and the network.

import type { AonObject } from "./object.js";

export class AonNodeClient {
  constructor(public baseUrl: string) {}

  async getObject(hash: string): Promise<AonObject | null> {
    const res = await fetch(`${this.baseUrl}/v1/objects/${hash}`);
    if (res.status === 404) return null;
    const json = await res.json();
    if (!json.ok) throw new Error(json.error?.code ?? "GET_OBJECT_FAILED");
    return json.object;
  }

  async putObject(object: AonObject) {
    const res = await fetch(`${this.baseUrl}/v1/objects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(object),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error?.code ?? "PUT_OBJECT_FAILED");
    return json;
  }

  async listObjects(filter?: {
    objectType?: string;
    namespace?: string;
    references?: string;
    limit?: number;
    offset?: number;
  }): Promise<AonObject[]> {
    const params = new URLSearchParams();
    if (filter?.objectType) params.set("objectType", filter.objectType);
    if (filter?.namespace)  params.set("namespace",  filter.namespace);
    if (filter?.references) params.set("references", filter.references);
    if (filter?.limit  != null) params.set("limit",  String(filter.limit));
    if (filter?.offset != null) params.set("offset", String(filter.offset));
    const res  = await fetch(`${this.baseUrl}/v1/objects?${params}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error?.code ?? "LIST_OBJECTS_FAILED");
    return json.objects;
  }

  async walkGraph(hash: string) {
    const res = await fetch(`${this.baseUrl}/v1/graph/walk/${hash}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error?.code ?? "WALK_GRAPH_FAILED");
    return json.graph;
  }

  async getGraph(hash: string) {
    const res = await fetch(`${this.baseUrl}/v1/graphs/${hash}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error?.code ?? "GET_GRAPH_FAILED");
    return json.graph;
  }
}
