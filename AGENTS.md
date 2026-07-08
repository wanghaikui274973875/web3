# AGENTS.md

## Cursor Cloud specific instructions

This is a single-product **Hardhat + Solidity (TypeScript)** smart-contract project. There is
no database, backend server, or long-running application service — contracts run against
Hardhat's in-process EVM. The frontend DApp lives in a separate repository (`web3-dapp`) and is
not part of this workspace.

### Build / test / run

Standard commands are defined in `package.json` scripts:

- Compile: `npm run build` (`hardhat compile`). `hardhat test` also auto-compiles.
- Test: `npm test` (`hardhat test`, Mocha/Chai + ethers v6 on the in-process EVM).
- Local deploy: `npm run deploy:local` (deploys `SampleERC20` to the in-process `hardhat` network).
- Standalone JSON-RPC chain (optional): `npx hardhat node` → `http://127.0.0.1:8545`, chainId `31337`.
  Deploy/interact against it with `npx hardhat run <script> --network localhost`.

### Non-obvious caveats

- **Known cross-test time contamination (not an environment issue):** running the full `npm test`
  suite currently shows 2 failing `MultisigWallet` EIP-712 tests with `TxExpired()`. These tests
  compute `deadline` from real wall-clock `Date.now()`, but earlier auction/staking tests advance
  the shared Hardhat EVM clock via `time.increase()`, pushing `block.timestamp` past the deadline.
  Run the file in isolation to confirm it passes: `npx hardhat test test/MultisigWallet.ts`
  (all 15 pass). Do not treat these 2 failures as a setup problem.
- **`SampleERC20` supply is raw units**, not scaled by decimals. The constructor's `totalSupply_`
  is minted verbatim (e.g. `deploy(name, sym, 18, 1000)` mints only 1000 wei). Use
  `ethers.parseUnits("1000", 18)` for a human-readable supply.
- **No linter is configured** (no ESLint/Solhint). Only Prettier formatting config exists
  (`.prettierrc.json`) with no npm script wired up.
- Sepolia deploy scripts (`deploy:sepolia:*`), Etherscan verification, and the `multisig:*` tasks
  require `.env` values (`SEPOLIA_RPC_URL`, `SEPOLIA_PRIVATE_KEY`, `ETHERSCAN_API_KEY`). These are
  optional and not needed for local compile/test/deploy. Copy `.env.example` to `.env` to use them.
- `tests/*.sol` are Remix-IDE style tests and are NOT run by `hardhat test` (which only runs
  `test/*.ts`).
