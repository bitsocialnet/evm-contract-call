import { describe, expect, it, beforeEach } from "vitest";
import { mainnet, polygon } from "viem/chains";
import {
  _clearViemClientCache,
  createEnsViemClient,
  createViemClient,
  getChainFromTicker
} from "../src/evm-contract-challenge.js";

// This file deliberately does NOT mock viem. The bug it guards against lived entirely in the transport
// viem builds: every other test mocks createPublicClient away, so an unusable client looked fine.

const MAINNET_RPC = "https://eth.example";
const POLYGON_RPC = "https://polygon.example";

beforeEach(() => {
  _clearViemClientCache();
});

describe("getChainFromTicker", () => {
  it("maps known tickers to their chain", () => {
    expect(getChainFromTicker("eth")?.id).toBe(mainnet.id);
    expect(getChainFromTicker("matic")?.id).toBe(polygon.id);
  });

  it("is case and whitespace insensitive", () => {
    expect(getChainFromTicker("ETH")?.id).toBe(mainnet.id);
    expect(getChainFromTicker("  Eth ")?.id).toBe(mainnet.id);
  });

  it("returns undefined for a ticker it does not know", () => {
    expect(getChainFromTicker("notachain")).toBeUndefined();
  });
});

describe("createViemClient", () => {
  // The regression test. Before the chain was passed, http() had no url and no chain to fall back on,
  // so createPublicClient threw UrlRequiredError for every ticker and the "rpcUrls is optional"
  // contract was never true for anyone.
  it("builds a usable client with no rpcUrls when the ticker has a built-in RPC", () => {
    const client = createViemClient(undefined, "eth");

    expect(client.chain?.id).toBe(mainnet.id);
    expect(client.transport.url).toBeTruthy();
  });

  it("builds a usable client with no rpcUrls on a non-mainnet ticker", () => {
    const client = createViemClient(undefined, "matic");

    expect(client.chain?.id).toBe(polygon.id);
    expect(client.transport.url).toBeTruthy();
  });

  it("throws a message naming rpcUrls when the ticker has no built-in RPC", () => {
    expect(() => createViemClient(undefined, "notachain")).toThrow(
      /option rpcUrls is required for chainTicker "notachain"/
    );
  });

  it("treats an empty rpcUrls string the same as an unset one", () => {
    expect(() => createViemClient("   ", "notachain")).toThrow(
      /option rpcUrls is required/
    );
    expect(createViemClient("   ", "eth").chain?.id).toBe(mainnet.id);
  });

  it("uses the configured rpcUrls when given, even for an unknown ticker", () => {
    const client = createViemClient(MAINNET_RPC, "notachain");

    expect(client.transport.url).toBe(MAINNET_RPC);
    expect(client.chain).toBeUndefined();
  });

  it("prefers the configured rpcUrls over the chain's built-in RPC", () => {
    expect(createViemClient(MAINNET_RPC, "eth").transport.url).toBe(MAINNET_RPC);
  });

  it("uses a fallback transport for multiple rpcUrls", () => {
    const client = createViemClient(
      `${MAINNET_RPC},https://eth2.example`,
      "eth"
    );

    expect(client.transport.type).toBe("fallback");
  });

  it("ignores blank entries and surrounding whitespace in rpcUrls", () => {
    const client = createViemClient(` ${MAINNET_RPC} , `, "eth");

    expect(client.transport.type).toBe("http");
    expect(client.transport.url).toBe(MAINNET_RPC);
  });

  // fallback(..., {rank: true}) starts an endpoint-ranking interval that is never torn down, so a
  // client built per call would leak one timer per verification step of every publish.
  it("reuses one client per (chainTicker, rpcUrls) instead of building one per call", () => {
    expect(createViemClient(MAINNET_RPC, "eth")).toBe(
      createViemClient(MAINNET_RPC, "eth")
    );
  });

  it("does not share a client between different chains or rpcUrls", () => {
    expect(createViemClient(MAINNET_RPC, "eth")).not.toBe(
      createViemClient(MAINNET_RPC, "matic")
    );
    expect(createViemClient(MAINNET_RPC, "eth")).not.toBe(
      createViemClient("https://other.example", "eth")
    );
  });
});

describe("createEnsViemClient", () => {
  // ENS lives on Ethereum mainnet. Without an explicit chain viem refuses the lookup outright with
  // "client chain not configured. universalResolverAddress is required", which is why the ENS branch
  // of the challenge could never succeed.
  it("always resolves against mainnet", () => {
    expect(createEnsViemClient(MAINNET_RPC, "eth").chain?.id).toBe(mainnet.id);
    expect(createEnsViemClient(POLYGON_RPC, "matic").chain?.id).toBe(mainnet.id);
    expect(createEnsViemClient(undefined, "notachain").chain?.id).toBe(mainnet.id);
  });

  it("reuses the community's rpcUrls when they already point at mainnet", () => {
    expect(createEnsViemClient(MAINNET_RPC, "eth").transport.url).toBe(MAINNET_RPC);
  });

  it("does not send mainnet ENS lookups to another chain's rpcUrls", () => {
    const client = createEnsViemClient(POLYGON_RPC, "matic");

    expect(client.transport.url).not.toBe(POLYGON_RPC);
    expect(client.transport.url).toBeTruthy();
  });

  // Unlike createViemClient, this one never throws for an unmapped ticker: mainnet always has a
  // built-in RPC, so there is always something to fall back to.
  it("builds a client for an unknown ticker rather than throwing", () => {
    expect(createEnsViemClient(undefined, "notachain").transport.url).toBeTruthy();
  });
});
