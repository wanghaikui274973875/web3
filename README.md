# web3

第一个 web3 学习仓库 — Hardhat 示例（ERC20、权限存储、Sepolia 部署等）。

## Sample ERC20 (Hardhat)

本地 Hardhat Solidity 示例，包含 ERC20 等合约。

### Requirements

- Node.js 18+

### Install

```bash
npm install
```

### Compile

```bash
npm run build
```

### Test

```bash
npm test
```

### Deploy (local hardhat network)

```bash
npm run deploy:local
```

### Deploy PermissionStorage (Sepolia)

配置根目录 `.env`（参考 `.env.example`）后：

```bash
npm run deploy:sepolia:permission
```
