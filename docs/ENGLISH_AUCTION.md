# 英式拍卖（EnglishAuctionHouse）部署与测试

本文档说明 **EnglishAuctionHouse** 在本地 Hardhat 与 **Sepolia 测试网** 上的编译、测试、部署及前端联调流程。

---

## 1. 架构与依赖

英式拍卖为 **多轮次 `roundId` 价高者得**，每轮可独立配置：

| 依赖合约 | 作用 | 部署命令 |
|----------|------|----------|
| **GameItem**（ERC721） | 被拍卖的 NFT | `npm run deploy:sepolia:nft` |
| **SampleERC20**（可选） | ERC20 出价轮次的支付代币 | `npm run deploy:sepolia:erc20` |
| **EnglishAuctionHouse** | 拍卖主合约 | `npm run deploy:sepolia:english-auction` |

- **ETH 轮次**：`createRound` 时 `paymentToken = address(0)`。
- **ERC20 轮次**：`paymentToken` 填 SampleERC20 地址；买家须 `approve` 或 `permit` 后 `bidWithToken`。
- **结算模型**：Pull 退款 + Pull 结算（`claimRefund` / `claimProceeds` / `claimItem`），避免 push 转账 DoS。

合约源码：`hardhat/contracts/auction/EnglishAuctionHouse.sol`  
前端面板：`web3-dapp/src/components/EnglishAuctionPanel.vue`

---

## 2. 环境准备

### 2.1 Hardhat（`hardhat/`）

```bash
cd hardhat
npm install
```

复制 `hardhat/.env.example` → `hardhat/.env`，至少填写：

| 变量 | 说明 |
|------|------|
| `SEPOLIA_RPC_URL` | Sepolia JSON-RPC（Infura / Alchemy 等） |
| `SEPOLIA_PRIVATE_KEY` | 部署与测试钱包私钥（勿提交 Git） |

可选（部署时自动创建演示轮次）：

| 变量 | 说明 |
|------|------|
| `SEPOLIA_ENGLISH_AUCTION_DEMO_NFT` | 已部署 GameItem 地址 |
| `SEPOLIA_ENGLISH_AUCTION_DEMO_TOKEN_ID` | 演示轮次 tokenId（须已 mint 且 deployer 持有） |

### 2.2 前端（`web3-dapp/`）

```bash
cd web3-dapp
npm install
```

复制 `web3-dapp/.env.example` → `web3-dapp/.env`，部署完成后填入：

| 变量 | 说明 |
|------|------|
| `VITE_GAME_ITEM_NFT_ADDRESS` | GameItem |
| `VITE_ENGLISH_AUCTION_HOUSE_ADDRESS` | EnglishAuctionHouse |
| `VITE_SAMPLE_ERC20_ADDRESS` | SampleERC20（ERC20 轮次必填） |

修改 `.env` 后须 **重启** `npm run dev`。

---

## 3. 本地编译与自动化测试

### 3.1 编译

```bash
cd hardhat
npm run build
```

生成 `artifacts/` 与 `typechain-types/`。合约启用 `viaIR` 与优化器（见 `hardhat.config.ts`）。

### 3.2 运行全部英式拍卖测试

```bash
npx hardhat test test/EnglishAuctionHouse.ts
```

或运行工程内全部测试：

```bash
npm test
```

### 3.3 测试用例一览

| 用例 | 验证内容 |
|------|----------|
| createRound + depositItem | NFT 托管至 House |
| 首标与加价 | 被超越者 Pull 领取退款 |
| 拒收 ETH 的出价者 | 不阻塞后续加价 |
| ETH 出价金额 | 须与 `msg.value` 一致 |
| 出价过低 | `BidTooLow` revert |
| 开始前不能 bid | 时间窗校验 |
| finalize + claim | 赢家领 NFT、卖家领款 |
| 无出价 reclaim | 流拍 NFT 回卖家 |
| 开始前 cancel | 取消并退回 NFT |
| 多轮互不影响 | 独立 roundId |
| 结束后不能 bid | 时间窗校验 |
| 未结束前不能 finalize | `NotEnded` |
| ERC20 轮次 | Pull 退款与 Pull 结算 |
| ETH 轮调用 bidWithToken | revert |
| 开拍后、结束前仍可 depositItem | 补托管（错过 startTime 仍可 deposit） |
| abortUndepositedRound | 结束且从未托管时可作废轮次 |

### 3.4 Gas 参考（本地 Hardhat 网络）

```bash
npx hardhat run scripts/gasEnglishAuction.ts
```

输出 `createRound`、`depositItem`、`bid`、`finalizeRound`、`claim*` 等操作的 gas 消耗，便于对比优化效果。

---

## 4. Sepolia 部署顺序

建议按以下顺序执行（均在 `hardhat/` 目录）：

### 步骤 1：部署 GameItem

```bash
npm run deploy:sepolia:nft
```

终端输出示例：

```
GameItem deployed to: 0x...
写入 web3-dapp/.env：VITE_GAME_ITEM_NFT_ADDRESS=0x...
```

### 步骤 2（可选）：部署 SampleERC20

ERC20 出价轮次需要；纯 ETH 轮次可跳过。

```bash
npm run deploy:sepolia:erc20
```

可选环境变量（见 `deploySampleErc20Sepolia.ts`）：`TOKEN_NAME`、`TOKEN_SYMBOL`、`TOKEN_DECIMALS`、`TOKEN_SUPPLY`。

### 步骤 3：部署 EnglishAuctionHouse

```bash
npm run deploy:sepolia:english-auction
```

终端输出：

```
EnglishAuctionHouse: 0x...
写入 web3-dapp/.env：VITE_ENGLISH_AUCTION_HOUSE_ADDRESS=0x...
```

若配置了 `SEPOLIA_ENGLISH_AUCTION_DEMO_NFT` + `SEPOLIA_ENGLISH_AUCTION_DEMO_TOKEN_ID`，脚本会自动 `createRound` → `approve` → `depositItem` 创建一条可出价演示轮次。

### 步骤 4：更新前端并启动

将上述地址写入 `web3-dapp/.env`，然后：

```bash
cd ../web3-dapp
npm run dev
```

浏览器连接 **MetaMask → Sepolia**，打开英式拍卖面板。

> **重要**：合约逻辑或 ABI 变更后必须 **重新部署 House** 并更新 `.env`。旧地址上的轮次无法自动迁移。

---

## 5. Sepolia 联调测试流程（手动）

以下以 **卖家钱包 A**、**买家钱包 B** 为例（可用 MetaMask 切换账户）。

### 5.1 卖家：准备 NFT

1. 连接钱包 A（Sepolia）。
2. 在 **GameItem** 面板 `mint` 一个 NFT，记下 `tokenId`（如 `0`）。

### 5.2 卖家：创建拍卖轮次

1. 打开 **英式拍卖** 面板。
2. 填写 `tokenId`、开拍延迟（分钟）、持续时长、起拍价 `minBid`、加价幅度 `minIncrement`。
3. 勾选「使用 SampleERC20」则创建 ERC20 轮次（须已配置 `VITE_SAMPLE_ERC20_ADDRESS`）。
4. 点击 **createRound**。
5. 创建成功后会 **自动选中** 新轮次，并提示下一步。

### 5.3 卖家：授权并托管

1. 查看「开拍准备」四步检查（NFT 存在 → 你持有 → approve → deposit）。
2. 点击 **授权并托管 NFT**（一键 `approve` + `depositItem`）。
3. 若 MetaMask 提示 **pending 交易过多**（智能账户限制），先在钱包「活动」里等待上一笔确认，再重试；已 approve 时可点 **仅 depositItem**。

> **规则**：`depositItem` 须在 **endTime 之前** 完成；**开拍后仍可补托管**（不必在 startTime 之前）。

### 5.4 买家：出价

1. 切换到钱包 B（非卖家）。
2. 选中可出价轮次（显示「可出价」徽章）。
3. 页面会显示 **下一口价**（当前最高 + 加价幅度），输入框自动填入。
4. **ETH 轮次**：点击 `bid (ETH)`，`msg.value` 须等于出价金额。
5. **ERC20 轮次**：点击 `approve + bidWithToken`（前端会先 approve 再出价）。
6. 被超越后，在 **claimRefund** 领取退款（Pull 模型）。

### 5.5 结束与结算

拍卖 **endTime 过后**：

| 角色 | 操作 | 条件 |
|------|------|------|
| 任何人 | `finalizeRound` | 已托管、有人出价 |
| 被超越者 | `claimRefund` | 有 pending 退款 |
| 卖家 | `claimProceeds` | 已 finalize |
| 赢家 | `claimItem` | 已 finalize |

**流拍**（结束、已托管、无人出价）：卖家 `reclaim` 取回 NFT。

**从未托管且已结束**：卖家 `abortUndepositedRound`（或前端「作废未托管轮次」）清理状态。

---

## 6. Sepolia 联调截图清单（建议留存）

完成一次完整联调后，建议按下列顺序截图，便于写报告、PR 或排查问题。截图可存放在 `hardhat/docs/english-auction-screenshots/`（目录需自行创建，**勿提交含私钥/助记词的画面**）。

| 序号 | 场景 | 截图要点 |
|------|------|----------|
| 1 | 钱包与网络 | MetaMask 已连接 Sepolia、`chainId` 11155111、有余额 |
| 2 | GameItem mint | mint 成功、`tokenId`、Etherscan 交易链接 |
| 3 | createRound | 创建表单参数、成功提示、自动选中新 `roundId` |
| 4 | 开拍准备 | 四步检查（存在 / 持有 / approve / deposit）全绿 |
| 5 | 授权并托管 | `approve` + `depositItem` 两笔交易确认（或分步截图） |
| 6 | 可出价状态 | 轮次详情「已托管=是」、显示「可出价」徽章 |
| 7 | 出价 | 下一口价提示、输入金额、`bid` 交易确认 |
| 8 | 被超越退款 | 切换另一钱包加价后，原出价者 `claimRefund` |
| 9 | finalize | `endTime` 后 `finalizeRound` 成功 |
| 10 | 结算 | 卖家 `claimProceeds`、赢家 `claimItem` |
| 11 | Etherscan 读合约 | House 的 `getRound` / `roundCounter` 与前端一致 |

**Etherscan 交易页**（每笔关键操作各一张）建议包含：

- **Status**：Success  
- **From / To**：钱包与合约地址  
- **Input Data**：可展开看到 `createRound`、`depositItem`、`bid` 等方法  
- **Logs**：如 `RoundCreated`、`ItemDeposited`、`BidPlaced`、`RoundFinalized` 等事件  

前端面板底部成功提示里的 **Etherscan 链接** 可直接点开对应交易。

---

## 7. Etherscan 合约验证

验证后 Etherscan 会显示 **Read Contract / Write Contract**，可用网页直接调 `getRound`、`roundCounter` 等，无需写脚本。

### 7.1 申请 API Key

1. 登录 [Etherscan](https://etherscan.io/)（Sepolia 使用同一账号）。  
2. 打开 [API Keys](https://etherscan.io/myapikey) 创建 Key。  
3. 写入 `hardhat/.env`：

```env
ETHERSCAN_API_KEY=你的Key
```

### 7.2 验证命令（无构造参数）

**EnglishAuctionHouse** 与 **GameItem** 部署时均无 constructor 参数：

```bash
cd hardhat

# GameItem
npx hardhat verify --network sepolia <GameItem地址>

# EnglishAuctionHouse
npx hardhat verify --network sepolia <House地址>
```

将 `<GameItem地址>`、`<House地址>` 替换为部署终端输出的地址。

### 7.3 验证 SampleERC20（有构造参数）

构造签名为：`constructor(string name, string symbol, uint8 decimals, uint256 totalSupply)`  
`totalSupply` 为 **最小单位**（wei 精度），不是人类可读数量。

示例（默认部署：Sample Token / SMPL / 18 位 / 100 万枚）：

```bash
npx hardhat verify --network sepolia <SampleERC20地址> \
  "Sample Token" "SMPL" 18 1000000000000000000000000
```

若部署时改过环境变量，须与 `deploySampleErc20Sepolia.ts` 实际参数一致，例如：

```bash
# TOKEN_NAME=MyToken TOKEN_SYMBOL=MTK TOKEN_DECIMALS=18 TOKEN_SUPPLY=500000
npx hardhat verify --network sepolia <地址> "MyToken" "MTK" 18 500000000000000000000000
```

`500000000000000000000000` = `parseUnits("500000", 18)`。

### 7.4 验证成功标志

1. 终端输出 `Successfully verified contract`。  
2. 打开 `https://sepolia.etherscan.io/address/<合约地址>#code`，标签页由 **Contract**（未验证）变为带绿色勾的 **Contract Source Code Verified**。  
3. 出现 **Read as Proxy** 以外的 **Read Contract**、**Write Contract** 标签（非代理合约直接显示）。

### 7.5 常见验证问题

| 现象 | 处理 |
|------|------|
| `Invalid API Key` | 检查 `.env` 中 `ETHERSCAN_API_KEY`，重启终端 |
| `Already Verified` | 该地址已验证，无需重复 |
| `Bytecode does not match` | 编译器版本 / optimizer / viaIR 与部署时不一致；在本仓库重新 `npm run build` 后用相同源码再 verify |
| SampleERC20 参数错误 | 核对 name/symbol/decimals/**最小单位 totalSupply** |

### 7.6 验证后在 Etherscan 上快速自检

**EnglishAuctionHouse → Read Contract：**

| 函数 | 用途 |
|------|------|
| `roundCounter` | 已创建轮次数 |
| `getRound(roundId)` | 单轮 seller、tokenId、时间、最高价、state 等 |
| `isBiddable(roundId)` | 当前是否可出价 |
| `pendingRefund(roundId, account)` | 某地址待领退款 |

**GameItem → Read Contract：** `ownerOf`、`totalMinted`、`tokenURI` 等。

---

## 8. 链上环境检查（可选）

`scripts/checkSepoliaEnv.ts` 可读取 GameItem / House / SampleERC20 的链上状态（`roundCounter`、各轮 `itemDeposited`、`isBiddable` 等）。

使用前将脚本内的合约地址改为当前 `.env` 中的地址，然后：

```bash
npx hardhat run scripts/checkSepoliaEnv.ts --network sepolia
```

---

## 9. 常见问题

| 现象 | 原因 | 处理 |
|------|------|------|
| `ERC721NonexistentToken` / deposit 失败 | `createRound` 的 tokenId 未 mint | 先在 GameItem mint，tokenId 与链上一致 |
| `已开拍，不能 cancel` | cancel 仅允许 startTime 之前 | 开拍后不能 cancel；可继续 deposit（endTime 前）或等结束 abort |
| `in-flight transaction limit` | MetaMask 智能账户 pending 上限 | 等待或取消 pending 交易后再发 |
| 出价 0.01 失败，当前最高已是 0.01 | 下一口价 = 最高 + minIncrement | 出 ≥ 0.011（或页面「填入下一口价」） |
| 前端按钮无反应 / revert | `.env` 地址与链上合约版本不一致 | 重新部署并更新 `VITE_ENGLISH_AUCTION_HOUSE_ADDRESS`，重启 dev |
| 旧 House 轮次卡死 | 旧版要求 startTime 前 deposit | 部署新 House，重新 createRound |

---

## 10. 命令速查

```bash
# hardhat/
npm run build                              # 编译
npm test                                   # 全部测试
npx hardhat test test/EnglishAuctionHouse.ts   # 仅英式拍卖
npx hardhat run scripts/gasEnglishAuction.ts     # Gas 报告（本地）
npm run deploy:sepolia:nft                 # GameItem
npm run deploy:sepolia:erc20               # SampleERC20
npm run deploy:sepolia:english-auction     # EnglishAuctionHouse
npx hardhat verify --network sepolia <House地址>          # Etherscan 验证 House
npx hardhat verify --network sepolia <GameItem地址>       # 验证 GameItem
npx hardhat verify --network sepolia <ERC20地址> "Sample Token" "SMPL" 18 1000000000000000000000000
npx hardhat run scripts/checkSepoliaEnv.ts --network sepolia  # 链上诊断

# web3-dapp/
npm run dev                                # 开发服务器
npm run build                              # 类型检查 + 生产构建
```

---

## 11. 延伸阅读

- Hardhat 工程总览：[../README.md](../README.md)
- 前端联调说明：[../../web3-dapp/README.md](../../web3-dapp/README.md)
- OpenZeppelin ERC721 / ERC20：<https://docs.openzeppelin.com/contracts/>
