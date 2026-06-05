// SPDX-License-Identifier: MIT
// 开源许可证：MIT

pragma solidity ^0.8.30;
// Solidity 编译器版本（与项目 hardhat.config 一致）

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
// ERC721 接口：读 owner、safeTransferFrom 等

import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
// ERC721 接收者：实现 onERC721Received，允许合约通过 safeTransferFrom 收 NFT

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// ERC20 接口：可选的代币支付通道

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// SafeERC20：兼容非标准 ERC20 的 safeTransferFrom

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
// 重入锁：buy / cancel / reclaim 使用 nonReentrant

/// @title DutchAuction
/// @notice 荷兰拍卖：价格随时间从 startPrice 线性降至 endPrice，首个出价不低于当前价的买家成交。
/// @dev 卖家通过 deposit() 托管 ERC721；支持 ETH 或 ERC20 收款。成交后 ended=true，不可二次购买。
contract DutchAuction is ReentrancyGuard, ERC721Holder {
    // 继承重入保护 + ERC721 安全接收能力

    using SafeERC20 for IERC20;
    // 为 IERC20 类型启用 .safeTransferFrom 等扩展方法

    IERC721 public immutable nft;
    // 拍卖标的 NFT 合约地址（部署后不可改）

    uint256 public immutable tokenId;
    // 拍卖的 tokenId（部署后不可改）

    /// @dev paymentToken 为零地址时表示以原生 ETH 支付
    IERC20 public immutable paymentToken;
    // 支付代币合约；address(0) 在 buy() 分支中代表 ETH

    address public immutable seller;
    // 卖家地址，即部署本合约的 msg.sender

    uint256 public immutable startPrice;
    // 降价起始价（荷兰拍卖的最高价）

    uint256 public immutable endPrice;
    // 降价结束价（拍卖期末的最低价，可为 0）

    uint256 public immutable startTime;
    // 开始按时间降价的 unix 时间戳（秒）

    uint256 public immutable endTime;
    // 价格降至 endPrice 的时刻（须大于 startTime）

    address public buyer;
    // 成交买家地址；未售出时为零地址

    bool public ended;
    // 拍卖是否已终结（成交、取消或 reclaim 后置 true）

    bool public itemDeposited;
    // 卖家是否已通过 deposit() 将 NFT 托管到本合约

    /// @dev 拍卖状态；终结后 currentPrice() 按状态返回，不再随时间变
    enum AuctionState {
        Active,
        Sold,
        Cancelled,
        Expired
    }

    AuctionState public state;
    // Active=进行中 Sold=成交 Cancelled=取消 Expired=流拍取回

    uint256 public finalPrice;
    // 成交价；仅 Sold 时有效

    // ─── custom errors（省 gas，语义明确）────────────────────────────────────
    error InvalidPriceRange();
    // startPrice 须严格大于 endPrice
    error InvalidTimeRange();
    // endTime 须严格大于 startTime
    error NotSeller();
    // 仅 seller 可调用 deposit / cancel / reclaim
    error AuctionNotStarted();
    // 当前时间早于 startTime 时不能 buy
    error AuctionEnded();
    // ended 已为 true 时不能 buy
    error InsufficientPayment();
    // ETH 支付时 msg.value 小于 currentPrice()
    error NoPaymentExpected();
    // ERC20 支付时不应附带 msg.value
    error TransferFailed();
    // ETH 转账给买家（退款）或卖家失败
    error NotEnded();
    // reclaim 时当前时间尚未到达 endTime
    error AlreadySold();
    // reclaim 时拍卖已通过 buy 成交
    error CannotCancel();
    // 已过 startTime、已 ended，或 deposit 时已过 startTime
    error NotDeposited();
    // buy / reclaim 要求 NFT 已托管
    error AlreadyDeposited();
    // deposit 不可重复调用

    // ─── events（链下索引）──────────────────────────────────────────────────
    event ItemDeposited(address indexed seller, uint256 tokenId);
    // 卖家完成 NFT 托管
    event Purchased(address indexed buyer, uint256 price, uint256 timestamp);
    // 成交：买家、实付价格、区块时间
    event Cancelled(address indexed seller);
    // 开始前取消拍卖
    event Reclaimed(address indexed seller, uint256 tokenId);
    // 结束后无人购买，卖家取回 NFT

    /// @param nft_ 拍卖标的 ERC721 合约
    /// @param tokenId_ 标的 tokenId
    /// @param paymentToken_ 支付代币；零地址表示 ETH
    /// @param startPrice_ 起始价（须 > endPrice_）
    /// @param endPrice_ 结束时最低价（可为 0）
    /// @param startTime_ 开始降价时间（unix 秒）
    /// @param endTime_ 降至 endPrice_ 的时间（须 > startTime_）
    constructor(
        IERC721 nft_,
        uint256 tokenId_,
        IERC20 paymentToken_,
        uint256 startPrice_,
        uint256 endPrice_,
        uint256 startTime_,
        uint256 endTime_
    ) {
        if (startPrice_ <= endPrice_) revert InvalidPriceRange();
        // 荷兰拍卖要求起始价高于结束价，否则价格逻辑无意义
        if (endTime_ <= startTime_) revert InvalidTimeRange();
        // 必须有一段正的降价时间区间

        seller = msg.sender;
        // 部署者即卖家
        nft = nft_;
        tokenId = tokenId_;
        paymentToken = paymentToken_;
        startPrice = startPrice_;
        endPrice = endPrice_;
        startTime = startTime_;
        endTime = endTime_;
        // 写入 immutable 参数；不在此转移 NFT，由 deposit() 完成托管
    }

    /// @notice 卖家将 NFT 转入本合约；须在 startTime 之前调用
    function deposit() external {
        if (msg.sender != seller) revert NotSeller();
        // 仅卖家可托管标的
        if (itemDeposited) revert AlreadyDeposited();
        // 防止重复 deposit
        if (block.timestamp >= startTime) revert CannotCancel();
        // 拍卖已开始则不允许再 deposit（复用 CannotCancel 表示时机错误）

        itemDeposited = true;
        // 标记已托管，buy() 方可执行
        nft.safeTransferFrom(seller, address(this), tokenId);
        // 从卖家转入本合约；须事先 approve 或 setApprovalForAll

        emit ItemDeposited(seller, tokenId);
    }

    /// @notice 当前展示/应付价格
    /// @dev 进行中：按时间线性降价；成交→成交价；取消→0；流拍→endPrice
    function currentPrice() public view returns (uint256) {
        if (state == AuctionState.Sold) return finalPrice;
        if (state == AuctionState.Cancelled) return 0;
        if (state == AuctionState.Expired) return endPrice;
        return _livePrice();
    }

    /// @dev 进行中的实时价格（不考虑终结状态）
    function _livePrice() private view returns (uint256) {
        if (block.timestamp <= startTime) {
            return startPrice;
        }
        if (block.timestamp >= endTime) {
            return endPrice;
        }
        uint256 elapsed = block.timestamp - startTime;
        uint256 duration = endTime - startTime;
        return startPrice - ((startPrice - endPrice) * elapsed) / duration;
    }

    /// @notice 购买：支付 currentPrice()，获得 NFT；仅首个成功 buy 的买家成交
    function buy() external payable nonReentrant {
        if (!itemDeposited) revert NotDeposited();
        // 未托管 NFT 不允许出售
        if (ended) revert AuctionEnded();
        // 已成交/取消/取回后不可再买
        if (block.timestamp < startTime) revert AuctionNotStarted();
        // 未到开始时间不能买（此时尚未降价，但规则上禁止提前买）

        uint256 price = _livePrice();

        ended = true;
        state = AuctionState.Sold;
        finalPrice = price;
        buyer = msg.sender;

        if (address(paymentToken) == address(0)) {
            // ── ETH 支付分支 ──
            if (msg.value < price) revert InsufficientPayment();
            // 附带 ETH 须不少于当前价
            uint256 refund = msg.value - price;
            // 多付部分需退还买家
            if (refund > 0) {
                (bool okRefund, ) = msg.sender.call{value: refund}("");
                // 低级 call 退 ETH；可能触发接收方 fallback
                if (!okRefund) revert TransferFailed();
            }
            (bool okSeller, ) = seller.call{value: price}("");
            // 将应付金额转给卖家
            if (!okSeller) revert TransferFailed();
        } else {
            // ── ERC20 支付分支 ──
            if (msg.value != 0) revert NoPaymentExpected();
            // 禁止同时转 ETH，避免资金混淆
            paymentToken.safeTransferFrom(msg.sender, seller, price);
            // 从买家拉取代币到卖家；须事先 approve 给本合约
        }

        nft.safeTransferFrom(address(this), msg.sender, tokenId);
        // CEI-Interactions：将托管 NFT 转给买家

        emit Purchased(msg.sender, price, block.timestamp);
    }

    /// @notice 开始前卖家可取消；若已 deposit 则 NFT 退回卖家
    function cancel() external nonReentrant {
        if (msg.sender != seller) revert NotSeller();
        if (block.timestamp >= startTime || ended) revert CannotCancel();
        // 仅允许在 startTime 之前且拍卖未终结时取消

        ended = true;
        state = AuctionState.Cancelled;
        if (itemDeposited) {
            nft.safeTransferFrom(address(this), seller, tokenId);
            // 已托管则退还给卖家
        }

        emit Cancelled(seller);
    }

    /// @notice 拍卖时间结束后若仍未售出，卖家取回 NFT
    function reclaim() external nonReentrant {
        if (msg.sender != seller) revert NotSeller();
        if (!itemDeposited) revert NotDeposited();
        // 无托管资产无可取回
        if (block.timestamp < endTime) revert NotEnded();
        // 降价期未结束不能 reclaim（仍可等待买家 buy）
        if (ended) revert AlreadySold();
        // 已通过 buy 或 cancel 终结的不能 reclaim

        ended = true;
        state = AuctionState.Expired;
        nft.safeTransferFrom(address(this), seller, tokenId);

        emit Reclaimed(seller, tokenId);
    }
}
