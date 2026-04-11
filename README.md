# @bitsocial/evm-contract-challenge

An automatic challenge for `@pkcprotocol/pkc-js` communities that verifies an author's EVM wallet address meets a condition from a smart contract call. Community owners configure a contract address, ABI, and condition (for example, requiring a USDC balance greater than 1000), and the challenge runs transparently whenever an author publishes. It checks three verification paths in order: the author's linked wallet address, ENS/BSO domain resolution, or NFT avatar ownership. If any path passes, the author is allowed through.

## How it works

When an author publishes to a community with this challenge enabled, the community node calls a read-only smart contract method with the author's wallet address as the argument and compares the return value against a configured condition (e.g. `>1000`). The challenge tries three sources for the wallet address:

1. **Wallet address** — the `author.wallets[chainTicker]` address, verified via EIP-191 signature
2. **ENS/BSO domain** — if the author's address is a `.eth` or `.bso` domain, it resolves to an on-chain address
3. **NFT avatar** — the current owner of the author's avatar NFT

If any source produces a wallet that passes the contract call condition, the challenge succeeds. No user interaction is required.

## Requirements

- Node.js `>=22`
- ESM-only environment

## Install

### With bitsocial-cli

```bash
bitsocial challenge install @bitsocial/evm-contract-challenge
```

Edit your community to use the challenge:

```bash
bitsocial community edit your-community.bso \
  '--settings.challenges[0].name' evm-contract-call \
  '--settings.challenges[0].options.chainTicker' eth \
  '--settings.challenges[0].options.address' '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' \
  '--settings.challenges[0].options.abi' '{"constant":true,"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"}' \
  '--settings.challenges[0].options.condition' '>1000' \
  '--settings.challenges[0].options.error' 'You need at least 1000 USDC to post.'
```

### With pkc-js (TypeScript)

If you are running your own node locally without connecting over RPC, you can install via npm and register the challenge manually:

```bash
npm install @bitsocial/evm-contract-challenge
```

```ts
import PKC from "@pkcprotocol/pkc-js";
import { evmContractChallenge } from "@bitsocial/evm-contract-challenge";

PKC.challenges["evm-contract-call"] = evmContractChallenge;
```

Then set the challenge on your community:

```ts
await community.edit({
  settings: {
    challenges: [
      {
        name: "evm-contract-call",
        options: {
          chainTicker: "eth",
          address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          abi: '{"constant":true,"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"}',
          condition: ">1000",
          error: "You need at least 1000 USDC to post."
        }
      }
    ]
  }
});
```

## Challenge Options

All option values must be strings.

| Option | Default | Description |
|--------|---------|-------------|
| `chainTicker` | `"eth"` | The chain ticker (e.g. `eth`, `matic`) |
| `rpcUrl` | — | JSON-RPC URL for the chain (uses viem defaults if omitted) |
| `address` | *(required)* | The contract address to call |
| `abi` | *(required)* | The ABI of the contract method as a JSON object (not an array) |
| `condition` | *(required)* | Condition the return value must pass (`=`, `>`, or `<` followed by a value, e.g. `>1000`) |
| `error` | `"Contract call response doesn't pass condition."` | Custom error message shown when the condition fails |

## Scripts

```bash
npm run typecheck
npm run build
npm test
```
