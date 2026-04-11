# @bitsocial/evm-contract-challenge

Standalone EVM contract call challenge for `@pkcprotocol/pkc-js`.

## Requirements

- Node.js `>=22`
- ESM-only environment

## Install

```bash
npm install @bitsocial/evm-contract-challenge
```

## Usage

```ts
import Pkc from "@pkcprotocol/pkc-js";
import { evmContractChallenge } from "@bitsocial/evm-contract-challenge";

Pkc.challenges["evm-contract-call"] = evmContractChallenge;
```

## Challenge Options

- `chainTicker`: Chain key used from `plebbit.chainProviders` (example: `eth`)
- `address`: Contract address to call
- `abi`: JSON string of the contract method ABI
- `condition`: Comparison expression (`=`, `>`, `<`) against call result, e.g. `>1000`
- `error`: Custom error string returned when condition check fails

## Scripts

```bash
npm run typecheck
npm run build
npm test
```
