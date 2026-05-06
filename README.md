# web3

本仓库包含两个**相互独立**的子项目，请分别在各自目录安装依赖与执行命令。

## 1. 合约（Hardhat）

目录：`hardhat/`

```bash
cd hardhat
npm install
npm run build
npm test
npm run deploy:local
```

Sepolia 部署：在 `hardhat/.env` 配置 RPC 与私钥（参考 `hardhat/.env.example`）后：

```bash
cd hardhat
npm run deploy:sepolia:permission
```

## 2. 前端（Vue + MetaMask + ethers v6）

源码目录：`web3-dapp/`（本仓库根目录已 `.gitignore` 忽略，避免与独立前端仓库重复提交）。

独立远程：<https://github.com/wanghaikui274973875/web3-dapp.git>

```bash
git clone https://github.com/wanghaikui274973875/web3-dapp.git
cd web3-dapp
npm install
npm run dev
```

若你只在本地与 Hardhat 同仓开发，也可直接进入：

```bash
cd web3-dapp
npm install
npm run dev
```

---

- Node.js 建议 18+  
- 根目录不再放置 `package.json`；若本地仍残留根目录 `node_modules`，可关闭占用该目录的程序后手动删除。
