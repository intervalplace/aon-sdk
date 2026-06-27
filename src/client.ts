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

  async walkGraph(hash: string) {
    const res = await fetch(`${this.baseUrl}/v1/graph/walk/${hash}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error?.code ?? "WALK_GRAPH_FAILED");
    return json.graph;
  }
}
