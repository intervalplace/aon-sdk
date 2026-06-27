import { registerNamespace } from "./index.js";
import { evmSpotNamespace } from "./evm-spot/index.js";
import { csdUsdcNamespace } from "./csd-usdc/index.js";

export function registerDefaultNamespaces() {
  registerNamespace(evmSpotNamespace);
  registerNamespace(csdUsdcNamespace);
}
