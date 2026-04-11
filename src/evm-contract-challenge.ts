import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  type AbiFunction,
  type PublicClient
} from "viem";
import { normalize } from "viem/ens";
import type {
  ChallengeFileInput,
  ChallengeInput,
  ChallengeResultInput,
  GetChallengeArgsInput,
  HexAddress,
  PKC,
  PublicationWithCommunityAuthorFromDecryptedChallengeRequest,
  CommunityChallengeSetting
} from "./types.js";

const optionInputs: NonNullable<ChallengeFileInput["optionInputs"]> = [
  {
    option: "chainTicker",
    label: "chainTicker",
    default: "eth",
    description: "The chain ticker",
    placeholder: "eth",
    required: true
  },
  {
    option: "rpcUrl",
    label: "RPC URL",
    default: "",
    description: "The JSON-RPC URL for the chain.",
    placeholder: "https://eth.llamarpc.com"
  },
  {
    option: "address",
    label: "Address",
    default: "",
    description: "The contract address.",
    placeholder: "0x...",
    required: true
  },
  {
    option: "abi",
    label: "ABI",
    default: "",
    description: "The ABI of the contract method.",
    placeholder:
      '{"constant":true,"inputs":[{"internalType":"address","name":"account...',
    required: true
  },
  {
    option: "condition",
    label: "Condition",
    default: "",
    description: "The condition the contract call response must pass.",
    placeholder: ">1000",
    required: true
  },
  {
    option: "error",
    label: "Error",
    default: "Contract call response doesn't pass condition.",
    description: "The error to display to the author."
  }
];

const description =
  "The response from an EVM contract call passes a condition, e.g. a token balance challenge.";

const nftAbi: readonly unknown[] = [
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "tokenURI",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  }
];

const supportedConditionOperators = ["=", ">", "<"] as const;

type SupportedConditionOperator =
  (typeof supportedConditionOperators)[number];

type ConditionComparable = bigint | string;

const createViemClient = (rpcUrl?: string): PublicClient =>
  createPublicClient({ transport: http(rpcUrl) });

interface PKCWithOptionalAddressResolver extends PKC {
  getPKCAddressFromPublicKey?: (publicKey: string) => Promise<string>;
}

interface SharedVerifyProps {
  publication: PublicationWithCommunityAuthorFromDecryptedChallengeRequest;
  chainTicker: string;
  condition: string;
  abi: Record<string, unknown>;
  error: string | undefined;
  contractAddress: string;
  pkc: PKC;
  rpcUrl: string | undefined;
}

const publicationFieldNames = [
  "comment",
  "vote",
  "commentEdit",
  "commentModeration",
  "communityEdit"
] as const;

const isStringDomain = (value: string | undefined): value is string =>
  typeof value === "string" && value.includes(".");

const isEthAliasDomain = (address: string): boolean => {
  const lowerAddress = address.toLowerCase();
  return lowerAddress.endsWith(".eth") || lowerAddress.endsWith(".bso");
};

const normalizeEthAliasDomain = (address: string): string => {
  return address.toLowerCase().endsWith(".bso")
    ? `${address.slice(0, -4)}.eth`
    : address;
};

const derivePublicationFromChallengeRequest = (
  challengeRequestMessage: GetChallengeArgsInput["challengeRequestMessage"]
): PublicationWithCommunityAuthorFromDecryptedChallengeRequest => {
  for (const fieldName of publicationFieldNames) {
    const publication = challengeRequestMessage[fieldName];
    if (publication) {
      return publication;
    }
  }

  throw new Error("Failed to find publication on ChallengeRequest");
};

const getPublicationSignerAddress = async (
  pkc: PKC,
  publication: PublicationWithCommunityAuthorFromDecryptedChallengeRequest
): Promise<string> => {
  const maybeResolver = (pkc as PKCWithOptionalAddressResolver)
    .getPKCAddressFromPublicKey;
  if (typeof maybeResolver === "function") {
    return maybeResolver(publication.signature.publicKey);
  }

  return publication.author.address;
};

const verifyAuthorWalletAddress = async (
  props: SharedVerifyProps
): Promise<string | undefined> => {
  const authorWallet = props.publication.author.wallets?.[props.chainTicker];
  if (typeof authorWallet?.address !== "string") {
    return "The author wallet address is not defined";
  }

  if (isStringDomain(authorWallet.address)) {
    const resolvedWalletAddress = await props.pkc.resolveAuthorName({
      address: authorWallet.address
    });
    const publicationSignatureAddress = await getPublicationSignerAddress(
      props.pkc,
      props.publication
    );

    if (resolvedWalletAddress !== publicationSignatureAddress) {
      return "The author wallet address's pkc-author-address text record should resolve to the public key of the signature";
    }
  }

  const viemClient = createViemClient(props.rpcUrl);

  const messageToBeSigned: Record<string, string | number> = {};
  messageToBeSigned.domainSeparator = "plebbit-author-wallet";
  messageToBeSigned.authorAddress = props.publication.author.address;
  messageToBeSigned.timestamp = authorWallet.timestamp;

  const valid = await viemClient.verifyMessage({
    address: authorWallet.address as HexAddress,
    message: JSON.stringify(messageToBeSigned),
    signature: authorWallet.signature.signature as HexAddress
  });

  if (!valid) {
    return "The signature of the wallet is invalid";
  }

  const cache = await props.pkc._createStorageLRU({
    cacheName: "challenge_evm_contract_call_v1_wallet_last_timestamp",
    maxItems: Number.MAX_SAFE_INTEGER
  });

  const cacheKey = props.chainTicker + authorWallet.address;
  const lastTimestampRaw = await cache.getItem(cacheKey);
  const lastTimestampOfAuthor =
    typeof lastTimestampRaw === "number" ? lastTimestampRaw : undefined;

  if (
    typeof lastTimestampOfAuthor === "number" &&
    lastTimestampOfAuthor > authorWallet.timestamp
  ) {
    return "The author is trying to use an old wallet signature";
  }

  if ((lastTimestampOfAuthor ?? 0) < authorWallet.timestamp) {
    await cache.setItem(cacheKey, authorWallet.timestamp);
  }

  const walletValidationFailure = await validateWalletAddressWithCondition({
    authorWalletAddress: authorWallet.address,
    condition: props.condition,
    contractAddress: props.contractAddress,
    chainTicker: props.chainTicker,
    abi: props.abi,
    error: props.error,
    rpcUrl: props.rpcUrl
  });

  return walletValidationFailure;
};

const verifyAuthorENSAddress = async (
  props: SharedVerifyProps
): Promise<string | undefined> => {
  const authorAddress = props.publication.author.address;
  if (!isEthAliasDomain(authorAddress)) {
    return "Author address is not a .bso/.eth domain";
  }

  const ensAddress = normalizeEthAliasDomain(authorAddress);

  const viemClient = createViemClient(props.rpcUrl);

  if (typeof viemClient.getEnsAddress !== "function") {
    throw new Error("Failed to get owner of ENS address of author.address");
  }

  const ownerOfAddress = await viemClient.getEnsAddress({
    name: normalize(ensAddress)
  });

  if (!ownerOfAddress) {
    throw new Error("Failed to get owner of ENS address of author.address");
  }

  const walletValidationFailure = await validateWalletAddressWithCondition({
    authorWalletAddress: ownerOfAddress,
    condition: props.condition,
    contractAddress: props.contractAddress,
    chainTicker: props.chainTicker,
    abi: props.abi,
    error: props.error,
    rpcUrl: props.rpcUrl
  });

  return walletValidationFailure;
};

const verifyAuthorNftWalletAddress = async (
  props: SharedVerifyProps
): Promise<string | undefined> => {
  if (!props.publication.author.avatar) {
    return "Author has no avatar NFT set";
  }

  const nftAvatar = props.publication.author.avatar;

  const viemClient = createViemClient(props.rpcUrl);

  let currentOwner: HexAddress;
  try {
    if (typeof viemClient.readContract !== "function") {
      throw new Error("Viem readContract unavailable");
    }

    currentOwner = (await viemClient.readContract({
      abi: nftAbi,
      address: nftAvatar.address as HexAddress,
      functionName: "ownerOf",
      args: [nftAvatar.id]
    })) as HexAddress;
  } catch {
    return "Failed to read NFT contract";
  }

  const messageToBeSigned: Record<string, string | number> = {};
  messageToBeSigned.domainSeparator = "plebbit-author-avatar";
  messageToBeSigned.authorAddress = props.publication.author.address;
  messageToBeSigned.timestamp = nftAvatar.timestamp;
  messageToBeSigned.tokenAddress = nftAvatar.address;
  messageToBeSigned.tokenId = String(nftAvatar.id);

  const valid = await viemClient.verifyMessage({
    address: currentOwner,
    message: JSON.stringify(messageToBeSigned),
    signature: nftAvatar.signature.signature as HexAddress
  });

  if (!valid) {
    return "The signature of the nft avatar is invalid";
  }

  const nftWalletValidationFailure = await validateWalletAddressWithCondition({
    authorWalletAddress: currentOwner,
    condition: props.condition,
    contractAddress: props.contractAddress,
    chainTicker: props.chainTicker,
    abi: props.abi,
    error: props.error,
    rpcUrl: props.rpcUrl
  });

  return nftWalletValidationFailure;
};

const getContractCallResponse = async (props: {
  chainTicker: string;
  contractAddress: string;
  abi: Record<string, unknown>;
  authorWalletAddress: string;
  rpcUrl: string | undefined;
}): Promise<unknown> => {
  const viemClient = createViemClient(props.rpcUrl);

  const encodedParameters = encodeFunctionData({
    abi: [props.abi as AbiFunction],
    args: [props.authorWalletAddress as HexAddress]
  } as never);

  const encodedData = await viemClient.call({
    data: encodedParameters,
    to: props.contractAddress as HexAddress
  });

  if (!encodedData.data) {
    throw new Error("The call did not return with data");
  }

  const decodedData = decodeFunctionResult({
    abi: [props.abi as AbiFunction],
    data: encodedData.data
  } as never);

  return decodedData;
};

const parseCondition = (condition: string): {
  operator: SupportedConditionOperator;
  value: string;
} => {
  const operatorInCondition = supportedConditionOperators.find((operator) =>
    condition.startsWith(operator)
  );

  if (!operatorInCondition) {
    throw new Error(
      "Incorrect condition is set, make sure the condition operator is supported"
    );
  }

  const valueInCondition = condition.split(operatorInCondition)[1] ?? "";
  return {
    operator: operatorInCondition,
    value: valueInCondition
  };
};

const toComparableValue = (
  value: unknown,
  numeric: boolean
): ConditionComparable => {
  if (numeric) {
    return BigInt(value as string | number | bigint);
  }

  return String(value);
};

const evaluateConditionString = (
  condition: string,
  responseValue: unknown
): boolean => {
  const parsedCondition = parseCondition(condition);

  const isNumericCondition = /^\d+$/.test(parsedCondition.value);
  const conditionValueParsed = toComparableValue(
    parsedCondition.value,
    isNumericCondition
  );
  const responseValueParsed = toComparableValue(responseValue, isNumericCondition);

  if (typeof conditionValueParsed !== typeof responseValueParsed) {
    throw new Error("value of condition and response should be the same");
  }

  if (parsedCondition.operator === "=") {
    return responseValueParsed === conditionValueParsed;
  }
  if (parsedCondition.operator === ">") {
    return responseValueParsed > conditionValueParsed;
  }
  if (parsedCondition.operator === "<") {
    return responseValueParsed < conditionValueParsed;
  }

  throw new Error("Failed to parse condition. Please double check code and set condition");
};

const validateWalletAddressWithCondition = async (props: {
  authorWalletAddress: string;
  condition: string;
  chainTicker: string;
  contractAddress: string;
  abi: Record<string, unknown>;
  error: string | undefined;
  rpcUrl: string | undefined;
}): Promise<string | undefined> => {
  let contractCallResponse: unknown;
  try {
    contractCallResponse = await getContractCallResponse({
      chainTicker: props.chainTicker,
      contractAddress: props.contractAddress,
      abi: props.abi,
      authorWalletAddress: props.authorWalletAddress,
      rpcUrl: props.rpcUrl
    });
  } catch {
    return "Failed getting contract call response from blockchain.";
  }

  if (!evaluateConditionString(props.condition, contractCallResponse)) {
    return props.error || "Contract call response doesn't pass condition.";
  }

  return undefined;
};

const parseChallengeAbi = (abi: string): Record<string, unknown> => {
  const parsed = JSON.parse(abi) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("option abi must be a JSON object");
  }
  return parsed as Record<string, unknown>;
};

const getChallenge = async ({
  challengeSettings,
  challengeRequestMessage,
  community
}: GetChallengeArgsInput): Promise<ChallengeResultInput> => {
  let { chainTicker, address, abi, condition, error, rpcUrl } =
    challengeSettings?.options || {};

  if (!chainTicker) {
    throw new Error("missing option chainTicker");
  }
  if (!address) {
    throw new Error("missing option address");
  }
  if (!abi) {
    throw new Error("missing option abi");
  }
  if (!condition) {
    throw new Error("missing option condition");
  }

  const doesConditionStartWithSupportedOperator =
    supportedConditionOperators.find((operator) => condition.startsWith(operator));
  if (!doesConditionStartWithSupportedOperator) {
    throw new Error("Condition uses unsupported comparison operator");
  }

  const parsedAbi = parseChallengeAbi(abi);
  const publication = derivePublicationFromChallengeRequest(challengeRequestMessage);

  const sharedProps: SharedVerifyProps = {
    pkc: community._pkc,
    abi: parsedAbi,
    condition,
    error,
    chainTicker,
    publication,
    contractAddress: address,
    rpcUrl
  };

  const walletFailureReason = await verifyAuthorWalletAddress(sharedProps);
  if (!walletFailureReason) {
    return { success: true };
  }

  const ensAuthorAddressFailureReason = await verifyAuthorENSAddress(sharedProps);
  if (!ensAuthorAddressFailureReason) {
    return { success: true };
  }

  const nftWalletAddressFailureReason = await verifyAuthorNftWalletAddress(
    sharedProps
  );
  if (!nftWalletAddressFailureReason) {
    return { success: true };
  }

  const errorString =
    `Author (${publication.author.address}) has failed all EVM challenges, ` +
    `walletFailureReason='${walletFailureReason}', ` +
    `ensAuthorAddressFailureReason='${ensAuthorAddressFailureReason}', ` +
    `nftWalletAddressFailureReason='${nftWalletAddressFailureReason}'`;

  return { success: false, error: errorString };
};

function evmContractChallenge({
  challengeSettings
}: {
  challengeSettings: CommunityChallengeSetting;
}): ChallengeFileInput {
  const chainTicker = challengeSettings?.options?.chainTicker;
  const type = `chain/${chainTicker || "eth"}` as ChallengeInput["type"];
  return { getChallenge, optionInputs, type, description };
}

export { description, optionInputs };
export default evmContractChallenge;
