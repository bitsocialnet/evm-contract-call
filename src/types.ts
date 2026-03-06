export type HexAddress = `0x${string}`;

export interface ChainProvider {
  urls: string[];
  chainId?: number;
}

export interface StorageLruLike {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;
}

export interface ViemClientCallResult {
  data?: HexAddress;
}

export interface ViemClientLike {
  verifyMessage(args: {
    address: HexAddress;
    message: string;
    signature: HexAddress;
  }): Promise<boolean>;
  call(args: { data: HexAddress; to: HexAddress }): Promise<ViemClientCallResult>;
  getEnsAddress?(args: { name: string }): Promise<HexAddress | null | undefined>;
  readContract?(args: {
    abi: readonly unknown[];
    address: HexAddress;
    functionName: string;
    args: readonly unknown[];
  }): Promise<unknown>;
}

export interface PlebbitLike {
  chainProviders: Record<string, ChainProvider>;
  _domainResolver: {
    _createViemClientIfNeeded(chainTicker: string, url: string): ViemClientLike;
  };
  resolveAuthorAddress(args: { address: string }): Promise<string>;
  _createStorageLRU(args: {
    cacheName: string;
    maxItems: number;
  }): Promise<StorageLruLike>;
}

export interface SubplebbitLike {
  _plebbit: PlebbitLike;
}

export interface AuthorWalletSignature {
  signature: HexAddress;
  type: string;
}

export interface AuthorWallet {
  address: string;
  signature: AuthorWalletSignature;
  timestamp: number;
}

export interface AuthorAvatarSignature {
  signature: HexAddress;
  type: string;
}

export interface AuthorAvatar {
  address: string;
  chainTicker: string;
  id: string | number;
  timestamp: number;
  signature: AuthorAvatarSignature;
}

export interface PublicationAuthor {
  address: string;
  wallets?: Record<string, AuthorWallet>;
  avatar?: AuthorAvatar;
}

export interface PublicationSignature {
  publicKey: string;
}

export interface PublicationWithSubplebbitAuthorFromDecryptedChallengeRequest {
  author: PublicationAuthor;
  signature: PublicationSignature;
}

export interface DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor {
  comment?: PublicationWithSubplebbitAuthorFromDecryptedChallengeRequest;
  post?: PublicationWithSubplebbitAuthorFromDecryptedChallengeRequest;
  reply?: PublicationWithSubplebbitAuthorFromDecryptedChallengeRequest;
  vote?: PublicationWithSubplebbitAuthorFromDecryptedChallengeRequest;
  commentEdit?: PublicationWithSubplebbitAuthorFromDecryptedChallengeRequest;
  commentModeration?: PublicationWithSubplebbitAuthorFromDecryptedChallengeRequest;
  subplebbitEdit?: PublicationWithSubplebbitAuthorFromDecryptedChallengeRequest;
}

export interface ChallengeOptionInput {
  option: string;
  label: string;
  default: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
}

export interface SubplebbitChallengeSetting {
  path?: string;
  name?: string;
  options?: Record<string, string>;
  exclude?: unknown;
  description?: string;
  pendingApproval?: boolean;
}

export interface ChallengeResultInput {
  success: boolean;
  error?: string;
}

export interface ChallengeInput {
  challenge: string;
  verify(answer: string): Promise<ChallengeResultInput>;
  type: string;
}

export interface ChallengeFileInput {
  optionInputs?: ChallengeOptionInput[];
  type: ChallengeInput["type"];
  challenge?: ChallengeInput["challenge"];
  caseInsensitive?: boolean;
  description?: string;
  getChallenge(
    args: GetChallengeArgsInput
  ): Promise<ChallengeInput | ChallengeResultInput>;
}

export interface GetChallengeArgsInput {
  challengeSettings: SubplebbitChallengeSetting;
  challengeRequestMessage: DecryptedChallengeRequestMessageTypeWithSubplebbitAuthor;
  challengeIndex: number;
  subplebbit: SubplebbitLike;
}

export interface ChallengeFileFactoryArgs {
  challengeSettings: SubplebbitChallengeSetting;
}

export type ChallengeFileFactoryInput = (
  args: ChallengeFileFactoryArgs
) => ChallengeFileInput;
