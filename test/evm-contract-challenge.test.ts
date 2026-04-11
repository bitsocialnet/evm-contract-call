import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyMessage } from "viem";
import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount
} from "viem/accounts";
import evmContractChallenge from "../src/evm-contract-challenge.js";
import type {
  ChallengeResultInput,
  GetChallengeArgsInput,
  HexAddress,
  PublicationWithCommunityAuthorFromDecryptedChallengeRequest,
  CommunityChallengeSetting
} from "../src/types.js";

type AuthorWallet = NonNullable<NonNullable<PublicationWithCommunityAuthorFromDecryptedChallengeRequest["author"]["wallets"]>[string]>;
type AuthorAvatar = NonNullable<PublicationWithCommunityAuthorFromDecryptedChallengeRequest["author"]["avatar"]>;

interface MockViemClient {
  verifyMessage: (args: { address: HexAddress; message: string; signature: HexAddress }) => Promise<boolean>;
  call: (args: { data: HexAddress; to: HexAddress }) => Promise<{ data?: HexAddress }>;
  getEnsAddress?: (args: { name: string }) => Promise<HexAddress | null | undefined>;
  readContract?: (args: { abi: readonly unknown[]; address: HexAddress; functionName: string; args: readonly unknown[] }) => Promise<unknown>;
}

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: () => currentMockClient
  };
});

let currentMockClient: MockViemClient;

const CONTRACT_ADDRESS =
  "0xEA81DaB2e0EcBc6B5c4172DE4c22B6Ef6E55Bd8f" as const;
const TOKEN_ADDRESS =
  "0x890a2e81836e0E76e0F49995e6b51ca6ce6F39ED" as const;
const BALANCE_ABI_JSON =
  '{"constant":true,"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"}';
const HIGH_BALANCE_DATA =
  "0x0000000000000000000000000000000000000000865a0735887d15fcf91fa302" as HexAddress;
const ZERO_BALANCE_DATA =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as HexAddress;
const DEFAULT_AUTHOR_ADDRESS = "author-address";
const DEFAULT_RPC_URLS = "https://eth.example";

const DEFAULT_OPTIONS = {
  chainTicker: "eth",
  rpcUrls: DEFAULT_RPC_URLS,
  address: CONTRACT_ADDRESS,
  abi: BALANCE_ABI_JSON,
  condition: ">1000",
  error: "PLEB token balance must be greater than 1000."
};

let account: PrivateKeyAccount;

beforeAll(() => {
  account = privateKeyToAccount(generatePrivateKey());
});

beforeEach(() => {
  // Clear the viem client cache between tests by resetting the mock module
  vi.resetModules;
});

const createChallengeSettings = (
  overrides: Partial<typeof DEFAULT_OPTIONS> = {}
): CommunityChallengeSetting => ({
  name: "evm-contract-call",
  options: {
    ...DEFAULT_OPTIONS,
    ...overrides
  }
});

const createClient = (overrides: Partial<MockViemClient> = {}): MockViemClient => {
  const client: MockViemClient = {
    verifyMessage: overrides.verifyMessage ?? (async () => false),
    call: overrides.call ?? (async () => ({ data: ZERO_BALANCE_DATA }))
  };

  if (overrides.getEnsAddress) {
    client.getEnsAddress = overrides.getEnsAddress;
  }
  if (overrides.readContract) {
    client.readContract = overrides.readContract;
  }

  return client;
};

const createCommunity = (params: {
  resolveAuthorName?: (args: { address: string }) => Promise<string | null>;
} = {}) => {
  const storage = new Map<string, unknown>();

  const pkc = {
    resolveAuthorName:
      params.resolveAuthorName ?? (async ({ address }: { address: string }) => address),
    _createStorageLRU: async () => ({
      getItem: async (key: string) => storage.get(key),
      setItem: async (key: string, value: unknown) => {
        storage.set(key, value);
      }
    })
  };

  return { _pkc: pkc };
};

const createPublication = (params: {
  authorAddress?: string;
  wallet?: AuthorWallet;
  avatar?: AuthorAvatar;
}): PublicationWithCommunityAuthorFromDecryptedChallengeRequest => {
  const authorAddress = params.authorAddress ?? DEFAULT_AUTHOR_ADDRESS;

  return {
    author: {
      address: authorAddress,
      ...(params.wallet ? { wallets: { eth: params.wallet } } : {}),
      ...(params.avatar ? { avatar: params.avatar } : {})
    },
    signature: { type: "ed25519", signature: "", publicKey: "mock-public-key", signedPropertyNames: [] }
  } as unknown as PublicationWithCommunityAuthorFromDecryptedChallengeRequest;
};

const createWalletMessage = (authorAddress: string, timestamp: number): string => {
  const message: Record<string, string | number> = {};
  message.domainSeparator = "plebbit-author-wallet";
  message.authorAddress = authorAddress;
  message.timestamp = timestamp;
  return JSON.stringify(message);
};

const createAvatarMessage = (params: {
  authorAddress: string;
  timestamp: number;
  tokenAddress: string;
  tokenId: string;
}): string => {
  const message: Record<string, string | number> = {};
  message.domainSeparator = "plebbit-author-avatar";
  message.authorAddress = params.authorAddress;
  message.timestamp = params.timestamp;
  message.tokenAddress = params.tokenAddress;
  message.tokenId = params.tokenId;
  return JSON.stringify(message);
};

const signWalletProof = async (params: {
  authorAddress: string;
  corrupted?: boolean;
}): Promise<AuthorWallet> => {
  const timestamp = Math.round(Date.now() / 1000);
  const message = createWalletMessage(params.authorAddress, timestamp);
  const signedMessage = params.corrupted ? `${message}1` : message;

  const signature = await account.signMessage({ message: signedMessage });
  return {
    address: account.address,
    signature: { signature, type: "eip191" },
    timestamp
  };
};

const signAvatarProof = async (params: {
  authorAddress: string;
  corrupted?: boolean;
}): Promise<AuthorAvatar> => {
  const timestamp = Math.round(Date.now() / 1000);
  const tokenId = "5404";
  const message = createAvatarMessage({
    authorAddress: params.authorAddress,
    timestamp,
    tokenAddress: TOKEN_ADDRESS,
    tokenId
  });
  const signedMessage = params.corrupted ? `${message}1` : message;

  const signature = await account.signMessage({ message: signedMessage });
  return {
    address: TOKEN_ADDRESS,
    chainTicker: "matic",
    id: tokenId,
    timestamp,
    signature: { signature, type: "eip191" }
  };
};

const executeChallenge = async (params: {
  publication: PublicationWithCommunityAuthorFromDecryptedChallengeRequest;
  settings?: CommunityChallengeSetting;
  mockClient: MockViemClient;
}): Promise<ChallengeResultInput> => {
  const settings = params.settings ?? createChallengeSettings();
  const community = createCommunity();

  currentMockClient = params.mockClient;

  const challengeFile = evmContractChallenge({ challengeSettings: settings });
  const result = await challengeFile.getChallenge({
    challengeSettings: settings,
    challengeRequestMessage: { comment: params.publication } as unknown as GetChallengeArgsInput["challengeRequestMessage"],
    challengeIndex: 0,
    community: community as unknown as GetChallengeArgsInput["community"]
  });

  if (!("success" in result)) {
    throw new Error("Expected a challenge result");
  }

  return result;
};

describe("evmContractChallenge", () => {
  it("passes when wallet balance is over threshold", async () => {
    const wallet = await signWalletProof({ authorAddress: DEFAULT_AUTHOR_ADDRESS });

    const mockClient = createClient({
      verifyMessage,
      call: async () => ({ data: HIGH_BALANCE_DATA })
    });

    const result = await executeChallenge({
      publication: createPublication({ wallet }),
      mockClient
    });

    expect(result).toEqual({ success: true });
  });

  it("fails when wallet balance is below threshold and no ENS/NFT fallback", async () => {
    const wallet = await signWalletProof({ authorAddress: DEFAULT_AUTHOR_ADDRESS });

    const mockClient = createClient({
      verifyMessage,
      call: async () => ({ data: ZERO_BALANCE_DATA })
    });

    const result = await executeChallenge({
      publication: createPublication({ wallet }),
      mockClient
    });

    expect(result.success).toBe(false);
    expect((result as { error?: string }).error).toBe(
      "Author (author-address) has failed all EVM challenges, " +
        "walletFailureReason='PLEB token balance must be greater than 1000.', " +
        "ensAuthorAddressFailureReason='Author address is not a .bso/.eth domain', " +
        "nftWalletAddressFailureReason='Author has no avatar NFT set'"
    );
  });

  it("passes when wallet fails but NFT owner wallet passes", async () => {
    const wallet = await signWalletProof({ authorAddress: DEFAULT_AUTHOR_ADDRESS });
    const avatar = await signAvatarProof({ authorAddress: DEFAULT_AUTHOR_ADDRESS });

    let callCount = 0;
    const mockClient = createClient({
      verifyMessage,
      readContract: async () => account.address,
      call: async () => {
        callCount += 1;
        return {
          data: callCount === 1 ? ZERO_BALANCE_DATA : HIGH_BALANCE_DATA
        };
      }
    });

    const result = await executeChallenge({
      publication: createPublication({ wallet, avatar }),
      mockClient
    });

    expect(result).toEqual({ success: true });
  });

  it("fails when both wallet and NFT wallets are below threshold", async () => {
    const wallet = await signWalletProof({ authorAddress: DEFAULT_AUTHOR_ADDRESS });
    const avatar = await signAvatarProof({ authorAddress: DEFAULT_AUTHOR_ADDRESS });

    const mockClient = createClient({
      verifyMessage,
      readContract: async () => account.address,
      call: async () => ({ data: ZERO_BALANCE_DATA })
    });

    const result = await executeChallenge({
      publication: createPublication({ wallet, avatar }),
      mockClient
    });

    expect(result.success).toBe(false);
    expect((result as { error?: string }).error).toBe(
      "Author (author-address) has failed all EVM challenges, " +
        "walletFailureReason='PLEB token balance must be greater than 1000.', " +
        "ensAuthorAddressFailureReason='Author address is not a .bso/.eth domain', " +
        "nftWalletAddressFailureReason='PLEB token balance must be greater than 1000.'"
    );
  });

  it("fails with invalid wallet signature", async () => {
    const wallet = await signWalletProof({
      authorAddress: DEFAULT_AUTHOR_ADDRESS,
      corrupted: true
    });

    const mockClient = createClient({
      verifyMessage,
      call: async () => ({ data: ZERO_BALANCE_DATA })
    });

    const result = await executeChallenge({
      publication: createPublication({ wallet }),
      mockClient
    });

    expect(result.success).toBe(false);
    expect((result as { error?: string }).error).toBe(
      "Author (author-address) has failed all EVM challenges, " +
        "walletFailureReason='The signature of the wallet is invalid', " +
        "ensAuthorAddressFailureReason='Author address is not a .bso/.eth domain', " +
        "nftWalletAddressFailureReason='Author has no avatar NFT set'"
    );
  });

  it("fails with invalid NFT signature", async () => {
    const avatar = await signAvatarProof({
      authorAddress: DEFAULT_AUTHOR_ADDRESS,
      corrupted: true
    });

    const mockClient = createClient({
      verifyMessage,
      readContract: async () => account.address,
      call: async () => ({ data: ZERO_BALANCE_DATA })
    });

    const result = await executeChallenge({
      publication: createPublication({ avatar }),
      mockClient
    });

    expect(result.success).toBe(false);
    expect((result as { error?: string }).error).toBe(
      "Author (author-address) has failed all EVM challenges, " +
        "walletFailureReason='The author wallet address is not defined', " +
        "ensAuthorAddressFailureReason='Author address is not a .bso/.eth domain', " +
        "nftWalletAddressFailureReason='The signature of the nft avatar is invalid'"
    );
  });

  it("passes for .eth author address when ENS owner wallet passes condition", async () => {
    const mockClient = createClient({
      verifyMessage,
      getEnsAddress: async () => account.address,
      call: async () => ({ data: HIGH_BALANCE_DATA })
    });

    const result = await executeChallenge({
      publication: createPublication({ authorAddress: "plebbit.eth" }),
      mockClient
    });

    expect(result).toEqual({ success: true });
  });

  it("passes for .bso author address when ENS owner wallet passes condition", async () => {
    const mockClient = createClient({
      verifyMessage,
      getEnsAddress: async () => account.address,
      call: async () => ({ data: HIGH_BALANCE_DATA })
    });

    const result = await executeChallenge({
      publication: createPublication({ authorAddress: "plebbit.bso" }),
      mockClient
    });

    expect(result).toEqual({ success: true });
  });

  it("throws for missing required options", async () => {
    const mockClient = createClient({
      verifyMessage,
      call: async () => ({ data: HIGH_BALANCE_DATA })
    });

    const publication = createPublication({
      wallet: await signWalletProof({ authorAddress: DEFAULT_AUTHOR_ADDRESS })
    });

    const missingCases: Array<{ key: string; expectedError: string }> = [
      { key: "chainTicker", expectedError: "missing option chainTicker" },
      { key: "address", expectedError: "missing option address" },
      { key: "abi", expectedError: "missing option abi" },
      { key: "condition", expectedError: "missing option condition" }
    ];

    for (const missingCase of missingCases) {
      const entries = Object.entries(DEFAULT_OPTIONS).filter(
        ([key]) => key !== missingCase.key
      );
      const options = Object.fromEntries(entries) as Record<string, string>;
      const settings: CommunityChallengeSetting = {
        name: "evm-contract-call",
        options
      };

      await expect(
        executeChallenge({
          publication,
          mockClient,
          settings
        })
      ).rejects.toThrow(missingCase.expectedError);
    }
  });

  it("throws for unsupported condition operator", async () => {
    const wallet = await signWalletProof({ authorAddress: DEFAULT_AUTHOR_ADDRESS });

    const mockClient = createClient({
      verifyMessage,
      call: async () => ({ data: HIGH_BALANCE_DATA })
    });

    await expect(
      executeChallenge({
        publication: createPublication({ wallet }),
        mockClient,
        settings: createChallengeSettings({ condition: "!1000" })
      })
    ).rejects.toThrow("Condition uses unsupported comparison operator");
  });

  it("passes when rpcUrls is omitted (uses viem defaults)", async () => {
    const wallet = await signWalletProof({ authorAddress: DEFAULT_AUTHOR_ADDRESS });

    const mockClient = createClient({
      verifyMessage,
      call: async () => ({ data: HIGH_BALANCE_DATA })
    });

    const { rpcUrls: _, ...optionsWithoutRpcUrl } = DEFAULT_OPTIONS;
    const settings: CommunityChallengeSetting = {
      name: "evm-contract-call",
      options: optionsWithoutRpcUrl
    };

    const result = await executeChallenge({
      publication: createPublication({ wallet }),
      mockClient,
      settings
    });

    expect(result).toEqual({ success: true });
  });

  it("returns chain type from chainTicker option", () => {
    const file = evmContractChallenge({
      challengeSettings: createChallengeSettings({ chainTicker: "matic" })
    });

    expect(file.type).toBe("chain/matic");
  });

  describe("ABI validation", () => {
    const VALID_ABI_BASE = {
      type: "function" as const,
      name: "balanceOf",
      inputs: [
        { internalType: "address", name: "account", type: "address" }
      ],
      outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
      stateMutability: "view"
    };

    const buildAbiJson = (
      overrides: Record<string, unknown>
    ): string => JSON.stringify({ ...VALID_ABI_BASE, ...overrides });

    const buildAbiJsonWithout = (...keysToOmit: string[]): string =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(VALID_ABI_BASE).filter(
            ([key]) => !keysToOmit.includes(key)
          )
        )
      );

    let mockClient: MockViemClient;
    let publication: ReturnType<typeof createPublication>;

    beforeAll(async () => {
      const wallet = await signWalletProof({
        authorAddress: DEFAULT_AUTHOR_ADDRESS
      });
      publication = createPublication({ wallet });
      mockClient = createClient({
        verifyMessage,
        call: async () => ({ data: HIGH_BALANCE_DATA })
      });
    });

    const expectAbiError = (abi: string, expectedError: string) =>
      expect(
        executeChallenge({
          publication,
          mockClient,
          settings: createChallengeSettings({ abi })
        })
      ).rejects.toThrow(expectedError);

    it("throws for invalid JSON", async () => {
      await expectAbiError("not json", "option abi is not valid JSON");
    });

    it("throws for JSON array", async () => {
      await expectAbiError("[]", "option abi must be a JSON object");
    });

    it("throws for JSON null", async () => {
      await expectAbiError("null", "option abi must be a JSON object");
    });

    it("throws for JSON string primitive", async () => {
      await expectAbiError('"hello"', "option abi must be a JSON object");
    });

    it('throws when type is not "function"', async () => {
      await expectAbiError(
        buildAbiJson({ type: "event" }),
        'option abi "type" must be "function"'
      );
    });

    it("throws for missing name", async () => {
      await expectAbiError(
        buildAbiJsonWithout("name"),
        'option abi must have a "name" string property'
      );
    });

    it("throws for missing inputs", async () => {
      await expectAbiError(
        buildAbiJsonWithout("inputs"),
        'option abi must have an "inputs" array property'
      );
    });

    it("throws when inputs has wrong number of parameters", async () => {
      await expectAbiError(
        buildAbiJson({
          inputs: [
            { name: "a", type: "address" },
            { name: "b", type: "uint256" }
          ]
        }),
        'option abi "inputs" must have exactly one parameter'
      );
    });

    it("throws when input type is not address", async () => {
      await expectAbiError(
        buildAbiJson({
          inputs: [{ name: "amount", type: "uint256" }]
        }),
        'option abi "inputs[0].type" must be "address"'
      );
    });

    it("throws for missing outputs", async () => {
      await expectAbiError(
        buildAbiJsonWithout("outputs"),
        'option abi must have an "outputs" array property'
      );
    });

    it("throws for empty outputs", async () => {
      await expectAbiError(
        buildAbiJson({ outputs: [] }),
        'option abi "outputs" must have at least one entry'
      );
    });

    it("throws for invalid stateMutability", async () => {
      await expectAbiError(
        buildAbiJson({ stateMutability: "readonly" }),
        'option abi "stateMutability" must be one of'
      );
    });

    it("accepts ABI without type field (defaults to function)", async () => {
      const result = await executeChallenge({
        publication,
        mockClient,
        settings: createChallengeSettings({
          abi: buildAbiJsonWithout("type")
        })
      });
      expect(result).toEqual({ success: true });
    });

    it("accepts ABI without stateMutability when constant is true", async () => {
      const abi = JSON.stringify({
        ...Object.fromEntries(
          Object.entries(VALID_ABI_BASE).filter(
            ([key]) => key !== "stateMutability"
          )
        ),
        constant: true
      });
      const result = await executeChallenge({
        publication,
        mockClient,
        settings: createChallengeSettings({ abi })
      });
      expect(result).toEqual({ success: true });
    });
  });
});
