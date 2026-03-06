import { beforeAll, describe, expect, it } from "vitest";
import { verifyMessage } from "viem";
import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount
} from "viem/accounts";
import evmContractChallenge from "../src/evm-contract-challenge.js";
import type {
  AuthorAvatar,
  AuthorWallet,
  ChallengeResultInput,
  HexAddress,
  PlebbitLike,
  PublicationWithSubplebbitAuthorFromDecryptedChallengeRequest,
  SubplebbitChallengeSetting,
  SubplebbitLike,
  ViemClientLike
} from "../src/types.js";

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

const DEFAULT_OPTIONS = {
  chainTicker: "eth",
  address: CONTRACT_ADDRESS,
  abi: BALANCE_ABI_JSON,
  condition: ">1000",
  error: "PLEB token balance must be greater than 1000."
};

let account: PrivateKeyAccount;

beforeAll(() => {
  account = privateKeyToAccount(generatePrivateKey());
});

const createChallengeSettings = (
  overrides: Partial<typeof DEFAULT_OPTIONS> = {}
): SubplebbitChallengeSetting => ({
  name: "evm-contract-call",
  options: {
    ...DEFAULT_OPTIONS,
    ...overrides
  }
});

const createClient = (overrides: Partial<ViemClientLike> = {}): ViemClientLike => {
  const client: ViemClientLike = {
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

const createSubplebbit = (params: {
  ethClient: ViemClientLike;
  maticClient?: ViemClientLike;
  resolveAuthorAddress?: PlebbitLike["resolveAuthorAddress"];
}): SubplebbitLike => {
  const storage = new Map<string, unknown>();

  const clients: Record<string, ViemClientLike> = {
    eth: params.ethClient,
    matic: params.maticClient ?? createClient()
  };

  const plebbit: PlebbitLike = {
    chainProviders: {
      eth: { urls: ["https://eth.example"], chainId: 1 },
      matic: { urls: ["https://matic.example"], chainId: 137 }
    },
    _domainResolver: {
      _createViemClientIfNeeded: (chainTicker: string) => {
        const client = clients[chainTicker];
        if (!client) {
          throw new Error(`No viem client for chain ${chainTicker}`);
        }
        return client;
      }
    },
    resolveAuthorAddress:
      params.resolveAuthorAddress ?? (async ({ address }) => address),
    _createStorageLRU: async () => ({
      getItem: async (key: string) => storage.get(key),
      setItem: async (key: string, value: unknown) => {
        storage.set(key, value);
      }
    })
  };

  return { _plebbit: plebbit };
};

const createPublication = (params: {
  authorAddress?: string;
  wallet?: AuthorWallet;
  avatar?: AuthorAvatar;
}): PublicationWithSubplebbitAuthorFromDecryptedChallengeRequest => {
  const authorAddress = params.authorAddress ?? DEFAULT_AUTHOR_ADDRESS;

  return {
    author: {
      address: authorAddress,
      ...(params.wallet ? { wallets: { eth: params.wallet } } : {}),
      ...(params.avatar ? { avatar: params.avatar } : {})
    },
    signature: { publicKey: "mock-public-key" }
  };
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
  publication: PublicationWithSubplebbitAuthorFromDecryptedChallengeRequest;
  settings?: SubplebbitChallengeSetting;
  ethClient: ViemClientLike;
  maticClient?: ViemClientLike;
}): Promise<ChallengeResultInput> => {
  const settings = params.settings ?? createChallengeSettings();
  const subplebbit = createSubplebbit({
    ethClient: params.ethClient,
    ...(params.maticClient ? { maticClient: params.maticClient } : {})
  });

  const challengeFile = evmContractChallenge({ challengeSettings: settings });
  const result = await challengeFile.getChallenge({
    challengeSettings: settings,
    challengeRequestMessage: { comment: params.publication },
    challengeIndex: 0,
    subplebbit
  });

  if (!("success" in result)) {
    throw new Error("Expected a challenge result");
  }

  return result;
};

describe("evmContractChallenge", () => {
  it("passes when wallet balance is over threshold", async () => {
    const wallet = await signWalletProof({ authorAddress: DEFAULT_AUTHOR_ADDRESS });

    const ethClient = createClient({
      verifyMessage,
      call: async () => ({ data: HIGH_BALANCE_DATA })
    });

    const result = await executeChallenge({
      publication: createPublication({ wallet }),
      ethClient
    });

    expect(result).toEqual({ success: true });
  });

  it("fails when wallet balance is below threshold and no ENS/NFT fallback", async () => {
    const wallet = await signWalletProof({ authorAddress: DEFAULT_AUTHOR_ADDRESS });

    const ethClient = createClient({
      verifyMessage,
      call: async () => ({ data: ZERO_BALANCE_DATA })
    });

    const result = await executeChallenge({
      publication: createPublication({ wallet }),
      ethClient
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
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
    const ethClient = createClient({
      verifyMessage,
      call: async () => {
        callCount += 1;
        return {
          data: callCount === 1 ? ZERO_BALANCE_DATA : HIGH_BALANCE_DATA
        };
      }
    });

    const maticClient = createClient({
      verifyMessage,
      readContract: async () => account.address
    });

    const result = await executeChallenge({
      publication: createPublication({ wallet, avatar }),
      ethClient,
      maticClient
    });

    expect(result).toEqual({ success: true });
  });

  it("fails when both wallet and NFT wallets are below threshold", async () => {
    const wallet = await signWalletProof({ authorAddress: DEFAULT_AUTHOR_ADDRESS });
    const avatar = await signAvatarProof({ authorAddress: DEFAULT_AUTHOR_ADDRESS });

    const ethClient = createClient({
      verifyMessage,
      call: async () => ({ data: ZERO_BALANCE_DATA })
    });

    const maticClient = createClient({
      verifyMessage,
      readContract: async () => account.address
    });

    const result = await executeChallenge({
      publication: createPublication({ wallet, avatar }),
      ethClient,
      maticClient
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
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

    const ethClient = createClient({
      verifyMessage,
      call: async () => ({ data: ZERO_BALANCE_DATA })
    });

    const result = await executeChallenge({
      publication: createPublication({ wallet }),
      ethClient
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
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

    const ethClient = createClient({
      verifyMessage,
      call: async () => ({ data: ZERO_BALANCE_DATA })
    });

    const maticClient = createClient({
      verifyMessage,
      readContract: async () => account.address
    });

    const result = await executeChallenge({
      publication: createPublication({ avatar }),
      ethClient,
      maticClient
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Author (author-address) has failed all EVM challenges, " +
        "walletFailureReason='The author wallet address is not defined', " +
        "ensAuthorAddressFailureReason='Author address is not a .bso/.eth domain', " +
        "nftWalletAddressFailureReason='The signature of the nft avatar is invalid'"
    );
  });

  it("passes for .eth author address when ENS owner wallet passes condition", async () => {
    const ethClient = createClient({
      verifyMessage,
      getEnsAddress: async () => account.address,
      call: async () => ({ data: HIGH_BALANCE_DATA })
    });

    const result = await executeChallenge({
      publication: createPublication({ authorAddress: "plebbit.eth" }),
      ethClient
    });

    expect(result).toEqual({ success: true });
  });

  it("passes for .bso author address when ENS owner wallet passes condition", async () => {
    const ethClient = createClient({
      verifyMessage,
      getEnsAddress: async () => account.address,
      call: async () => ({ data: HIGH_BALANCE_DATA })
    });

    const result = await executeChallenge({
      publication: createPublication({ authorAddress: "plebbit.bso" }),
      ethClient
    });

    expect(result).toEqual({ success: true });
  });

  it("throws for missing required options", async () => {
    const ethClient = createClient({
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
      const settings: SubplebbitChallengeSetting = {
        name: "evm-contract-call",
        options
      };

      await expect(
        executeChallenge({
          publication,
          ethClient,
          settings
        })
      ).rejects.toThrow(missingCase.expectedError);
    }
  });

  it("throws for unsupported condition operator", async () => {
    const wallet = await signWalletProof({ authorAddress: DEFAULT_AUTHOR_ADDRESS });

    const ethClient = createClient({
      verifyMessage,
      call: async () => ({ data: HIGH_BALANCE_DATA })
    });

    await expect(
      executeChallenge({
        publication: createPublication({ wallet }),
        ethClient,
        settings: createChallengeSettings({ condition: "!1000" })
      })
    ).rejects.toThrow("Condition uses unsupported comparison operator");
  });

  it("returns chain type from chainTicker option", () => {
    const file = evmContractChallenge({
      challengeSettings: createChallengeSettings({ chainTicker: "matic" })
    });

    expect(file.type).toBe("chain/matic");
  });
});
