export type {
  ChallengeFileInput,
  ChallengeInput,
  ChallengeResultInput,
  GetChallengeArgsInput,
  CommunityChallengeSetting
} from "@pkcprotocol/pkc-js/challenges";

import type { GetChallengeArgsInput } from "@pkcprotocol/pkc-js/challenges";

export type LocalCommunity = GetChallengeArgsInput["community"];
export type PKC = LocalCommunity["_pkc"];

type ChallengeRequestMessage = GetChallengeArgsInput["challengeRequestMessage"];
export type PublicationWithCommunityAuthorFromDecryptedChallengeRequest =
  NonNullable<ChallengeRequestMessage["vote"] | ChallengeRequestMessage["comment"] | ChallengeRequestMessage["commentEdit"] | ChallengeRequestMessage["commentModeration"] | ChallengeRequestMessage["communityEdit"]>;

export type HexAddress = `0x${string}`;
