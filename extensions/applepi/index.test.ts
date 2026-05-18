import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock the dependencies before importing the module
vi.mock("./bridge.js", () => ({
  BridgeManager: vi.fn().mockImplementation(() => ({
    run: vi.fn(),
    check: vi.fn(),
    benchmark: vi.fn(),
    ensureBinary: vi.fn(),
    getBinaryPath: vi.fn().mockReturnValue("/fake/path"),
    isBinaryBuilt: vi.fn().mockReturnValue(true),
    build: vi.fn(),
  })),
}));

vi.mock("./tools.js", () => ({
  createTools: vi.fn().mockReturnValue([
    { name: "applepi_query", label: "Query", description: "query", parameters: {}, execute: vi.fn() },
    { name: "applepi_generate", label: "Generate", description: "generate", parameters: {}, execute: vi.fn() },
    { name: "applepi_benchmark", label: "Benchmark", description: "benchmark", parameters: {}, execute: vi.fn() },
  ]),
}));

vi.mock("./provider.js", () => ({
  createProviderConfig: vi.fn().mockReturnValue({
    name: "Apple Intelligence",
    api: "apple-intelligence-api",
    models: [{ id: "apple-intelligence" }],
    streamSimple: vi.fn(),
  }),
}));

describe("extension entry point", () => {
  let registerToolCalls: any[];
  let registerProviderCalls: any[];
  let mockPi: any;

  beforeEach(async () => {
    registerToolCalls = [];
    registerProviderCalls = [];

    mockPi = {
      registerTool: vi.fn((tool: any) => registerToolCalls.push(tool)),
      registerProvider: vi.fn((name: string, config: any) =>
        registerProviderCalls.push({ name, config })
      ),
      registerCommand: vi.fn(),
      on: vi.fn(),
    };

    // Re-import to re-run the module
    vi.resetModules();
    // Re-apply mocks after resetModules
    vi.doMock("./bridge.js", () => ({
      BridgeManager: vi.fn().mockImplementation(() => ({
        run: vi.fn(),
        check: vi.fn(),
        benchmark: vi.fn(),
        ensureBinary: vi.fn(),
        getBinaryPath: vi.fn().mockReturnValue("/fake/path"),
        isBinaryBuilt: vi.fn().mockReturnValue(true),
        build: vi.fn(),
      })),
    }));

    vi.doMock("./tools.js", () => ({
      createTools: vi.fn().mockReturnValue([
        { name: "applepi_query", label: "Query", description: "query", parameters: {}, execute: vi.fn() },
        { name: "applepi_generate", label: "Generate", description: "generate", parameters: {}, execute: vi.fn() },
        { name: "applepi_benchmark", label: "Benchmark", description: "benchmark", parameters: {}, execute: vi.fn() },
      ]),
    }));

    vi.doMock("./provider.js", () => ({
      createProviderConfig: vi.fn().mockReturnValue({
        name: "Apple Intelligence",
        api: "apple-intelligence-api",
        models: [{ id: "apple-intelligence" }],
        streamSimple: vi.fn(),
      }),
    }));

    const mod = await import("./index.js");
    mod.default(mockPi);
  });

  test("registers three tools", () => {
    expect(mockPi.registerTool).toHaveBeenCalledTimes(3);
  });

  test("registers the applepi_query tool", () => {
    expect(registerToolCalls.find((t: any) => t.name === "applepi_query")).toBeTruthy();
  });

  test("registers the applepi_generate tool", () => {
    expect(registerToolCalls.find((t: any) => t.name === "applepi_generate")).toBeTruthy();
  });

  test("registers the applepi_benchmark tool", () => {
    expect(registerToolCalls.find((t: any) => t.name === "applepi_benchmark")).toBeTruthy();
  });

  test("registers the apple-intelligence provider", () => {
    expect(mockPi.registerProvider).toHaveBeenCalledWith(
      "apple-intelligence",
      expect.objectContaining({ name: "Apple Intelligence" })
    );
  });

  test("registers the /apple command", () => {
    expect(mockPi.registerCommand).toHaveBeenCalledWith(
      "apple",
      expect.objectContaining({ description: expect.stringContaining("Quick") })
    );
  });
});
