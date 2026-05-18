import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BridgeManager } from "./bridge.js";
import { createTools } from "./tools.js";
import { createProviderConfig } from "./provider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default function applepi(pi: any) {
  // Bridge source lives two dirs up from extensions/applepi/
  const bridgeDir = path.resolve(__dirname, "../../bridge");
  const bridge = new BridgeManager(bridgeDir);

  // Register tools
  const tools = createTools(bridge);
  for (const tool of tools) {
    pi.registerTool(tool);
  }

  // Register custom provider
  const providerConfig = createProviderConfig(bridge);
  pi.registerProvider("apple-intelligence", providerConfig);
}
