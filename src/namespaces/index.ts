import type { AonObject } from "../object.js";

export type NamespaceExecutionMode = "off" | "simulate" | "contract";

export type NamespaceEvaluation = {
  namespace: string;
  status: "waiting" | "executable" | "completed" | "consumed" | "invalid";
  graphs: any[];
};

export type NamespaceDriver = {
  namespace: string;

  normalizeAuthorization?: (auth: any) => any;
types?: () => any;
orderTypes?: () => any;
revocationTypes?: () => any;

  validateObject?: (obj: AonObject, graph?: any) => void | Promise<void>;

  evaluate: (objects: AonObject[], opts?: any) => NamespaceEvaluation | any[];

  reward?: (graph: any) => any;

  verify?: (graph: any) => any;

  execute?: (
    graph: any,
    args?: {
      mode?: NamespaceExecutionMode;
    }
  ) => Promise<any>;
};

const drivers = new Map<string, NamespaceDriver>();

export function registerNamespace(driver: NamespaceDriver) {
  if (!driver.namespace) throw new Error("NAMESPACE_MISSING");
  drivers.set(driver.namespace, driver);
  return driver;
}

export function getNamespace(namespace: string) {
  const driver = drivers.get(namespace);
  if (!driver) throw new Error("UNSUPPORTED_NAMESPACE");
  return driver;
}

export function listNamespaces() {
  return [...drivers.values()].map((d) => ({
    namespace: d.namespace,
  }));
}

export function evaluateNamespace(
  namespace: string,
  objects: AonObject[],
  opts?: any
) {
  return getNamespace(namespace).evaluate(objects, opts);
}
