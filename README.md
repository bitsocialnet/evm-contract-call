# @bitsocial/evm-contract-challenge

An automatic challenge for `@pkcprotocol/pkc-js` communities that verifies an author's EVM wallet address meets a condition from a smart contract call.

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
  '--settings.challenges[0].options.address' '0xEA81DaB2e0EcBc6B5c4172DE4c22B6Ef6E55Bd8f' \
  '--settings.challenges[0].options.abi' '{"constant":true,"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"}' \
  '--settings.challenges[0].options.condition' '>10000000000000000000' \
  '--settings.challenges[0].options.error' 'You need at least 10 Bitsocial tokens to post.'
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
          address: "0xEA81DaB2e0EcBc6B5c4172DE4c22B6Ef6E55Bd8f",
          abi: '{"constant":true,"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"}',
          condition: ">10000000000000000000",
          error: "You need at least 10 Bitsocial tokens to post."
        }
      }
    ]
  }
});
```

## Example Challenges

Each example uses a read-only contract function that takes a single `address` argument. The `condition` compares against the raw return value including decimal places (e.g. 10 USDC with 6 decimals = `10000000` raw).

### Common ABIs

<a id="balanceof-abi"></a>**`balanceOf`** — standard ERC-20 / ERC-721 token balance:

```json
{"constant":true,"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"}
```

<a id="getscore-abi"></a>**`getScore`** — Gitcoin Passport score (returns `uint256` with 4 decimals):

```json
{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getScore","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}
```

### Examples

| Description | `chainTicker` | `address` | ABI | `condition` |
|---|---|---|---|---|
| At least 10 Bitsocial (BSO) tokens | `eth` | `0xEA81DaB2e0EcBc6B5c4172DE4c22B6Ef6E55Bd8f` | [`balanceOf`](#balanceof-abi) | `>10000000000000000000` |
| Minimum 10 USDC | `eth` | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | [`balanceOf`](#balanceof-abi) | `>10000000` |
| Any WETH balance | `eth` | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | [`balanceOf`](#balanceof-abi) | `>0` |
| Gitcoin Passport score above 20 (proof of personhood) | `op` | `0xd6c51bB9E23bD7f1fEa22A3F2f85E3BFC8338Cb0` | [`getScore`](#getscore-abi) | `>200000` |
| At least 10 MATIC on Polygon | `matic` | `0x0000000000000000000000000000000000001010` | [`balanceOf`](#balanceof-abi) | `>10000000000000000000` |
| Any stETH balance (Lido staked ETH) | `eth` | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` | [`balanceOf`](#balanceof-abi) | `>0` |

> For chains other than Ethereum mainnet (e.g. Optimism, Polygon), you will also need to set `rpcUrls` to one or more JSON-RPC endpoints for that chain.

## Challenge Options

All option values must be strings.

| Option | Default | Description |
|--------|---------|-------------|
| `chainTicker` | `"eth"` | The chain ticker (e.g. `eth`, `matic`) |
| `rpcUrls` | — | Comma-separated JSON-RPC URLs for the chain (uses viem defaults if omitted) |
| `address` | *(required)* | The contract address to call |
| `abi` | *(required)* | The ABI of the contract method as a JSON object (not an array) |
| `condition` | *(required)* | Condition the return value must pass (`=`, `>`, or `<` followed by a value, e.g. `>1000`) |
| `error` | `"Contract call response doesn't pass condition."` | Custom error message shown when the condition fails |

## Multiple RPC URLs

You can provide multiple RPC endpoints as a comma-separated string:

```
https://eth.llamarpc.com,https://rpc.ankr.com/eth,https://eth.drpc.org
```

When multiple URLs are provided, viem's [`fallback`](https://viem.sh/docs/clients/transports/fallback) transport is used with automatic ranking enabled (`rank: true`). This means:

- Requests are sent to the highest-ranked RPC endpoint
- If a request fails, it automatically falls back to the next endpoint
- viem periodically pings all endpoints in the background and reorders them by latency and stability
- A single URL works the same as before (no fallback overhead)
- If `rpcUrls` is omitted, viem's built-in default RPCs are used

This improves reliability — if one RPC provider goes down, the challenge automatically uses the next available endpoint.

## Scripts

```bash
npm run typecheck
npm run build
npm test
```
