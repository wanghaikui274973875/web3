// SPDX-License-Identifier: MIT
// 开源许可证 MIT
pragma solidity ^0.8.30;
// Solidity 编译器版本

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
// 引入 ERC721 接口

import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
// 引入 ERC721 接收者 mixin（safeTransferFrom 回调）

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// 引入 ERC20 接口

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// 引入 SafeERC20 工具库

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
// 引入重入保护

/// @title EnglishAuctionHouse
/// @notice 英式拍卖：Pull 退款 + Pull 结算，避免 push 转账 DoS。
contract EnglishAuctionHouse is ReentrancyGuard, ERC721Holder {
    // 继承：重入锁 + 可收 NFT

    using SafeERC20 for IERC20;
    // 绑定 SafeERC20 到 IERC20

    /// @dev 轮次链上/展示状态；Active 通常仅由 _effectiveState 推导，不写入 storage
    enum RoundState {
        Pending, // 0 待开始或待 deposit
        Active, // 1 进行中（view 推导）
        Settled, // 2 款货均已领取
        Cancelled, // 3 卖家取消
        Expired, // 4 流拍
        Finalized // 5 已结束，待 Pull 领取
    }
    // 轮次状态枚举

    /// @dev 单轮拍卖链上数据
    struct Round {
        address seller;
        bool itemDeposited;
        RoundState state;
        bool proceedsClaimed;
        bool itemClaimed;
        address highestBidder;
        IERC721 nft;
        IERC20 paymentToken;
        uint256 tokenId;
        uint64 startTime;
        uint64 endTime;
        uint256 minBid;
        uint256 minIncrement;
        uint256 highestBid;
    }
    // 单轮数据；storage 打包：seller/flags 同槽，start/end uint64 同槽

    uint256 public roundCounter;
    // 公开：已创建轮次总数

    mapping(uint256 => Round) private _rounds;
    // 私有：roundId → Round

    mapping(uint256 => mapping(address => uint256)) private _pendingRefunds;
    // 私有：roundId → bidder → 待 Pull 领取的退款（ETH 或该轮 ERC20 单位）

    /// @dev 自定义错误（比 require 字符串省 gas）
    error InvalidTimeRange(); // 时间区间无效
    error InvalidMinBid(); // 起拍价或加价为 0
    error NotSeller(); // 非卖家调用
    error RoundNotFound(); // roundId 不存在
    error InvalidRoundState(); // 当前状态不允许此操作
    error NotDeposited(); // NFT 未托管
    error AlreadyDeposited(); // 重复 deposit
    error AuctionNotStarted(); // 尚未开拍
    error AuctionEnded(); // 已结束
    error BidTooLow(); // 出价低于规则
    error HasBids(); // 已有出价（不可取消/流拍取回）
    error NoBids(); // 无人出价（不可 finalize）
    error NotEnded(); // 尚未到 endTime
    error TransferFailed(); // ETH/代币转账失败
    error CannotCancel(); // 不可取消（已开拍等）
    error NoPaymentExpected(); // ETH 轮次误走 ERC20 路径
    error EthPaymentExpected(); // ERC20 轮次误走 ETH 路径
    error IncorrectPayment(); // msg.value ≠ amount
    error UnexpectedEth(); // ERC20 出价附带 ETH
    error NothingToClaim(); // 无待领退款
    error NotWinner(); // 非最高出价者
    error AlreadyClaimed(); // 重复 claimProceeds/claimItem

    event RoundCreated(
        uint256 indexed roundId,
        address indexed seller,
        address indexed nft,
        uint256 tokenId,
        address paymentToken,
        uint256 startTime,
        uint256 endTime,
        uint256 minBid,
        uint256 minIncrement
    );
    // 事件：创建轮次

    event ItemDeposited(uint256 indexed roundId, address indexed seller, uint256 tokenId);
    // 事件：NFT 托管

    event BidPlaced(uint256 indexed roundId, address indexed bidder, uint256 amount);
    // 事件：新出价

    event RefundAccrued(uint256 indexed roundId, address indexed bidder, uint256 amount);
    // 事件：被超越，退款记入 pending（Pull）

    event RefundClaimed(uint256 indexed roundId, address indexed bidder, uint256 amount);
    // 事件：领取退款

    event RoundFinalized(uint256 indexed roundId, address indexed winner, uint256 finalPrice);
    // 事件：结束标记，进入领取阶段

    event ProceedsClaimed(uint256 indexed roundId, address indexed seller, uint256 amount);
    // 事件：卖家领款

    event ItemClaimed(uint256 indexed roundId, address indexed winner, uint256 tokenId);
    // 事件：赢家领 NFT

    event RoundCompleted(uint256 indexed roundId, address indexed winner, uint256 finalPrice);
    // 事件：款、货均领完 → Settled

    event RoundCancelled(uint256 indexed roundId, address indexed seller);
    // 事件：取消

    event RoundReclaimed(uint256 indexed roundId, address indexed seller, uint256 tokenId);
    // 事件：流拍取回

    /// @notice 创建新拍卖轮次
    /// @dev msg.sender 成为 seller；创建后须调用 depositItem 托管 NFT
    /// @param nft_ 拍卖标的 ERC721 合约
    /// @param tokenId_ 拍卖 tokenId
    /// @param paymentToken_ 支付代币；零地址表示 ETH
    /// @param startTime_ 开拍 unix 时间戳（秒）
    /// @param endTime_ 结束 unix 时间戳（秒）
    /// @param minBid_ 首标最低金额
    /// @param minIncrement_ 每次加价最低增量
    /// @return roundId 新轮次 id（从 0 递增）
    function createRound(
        IERC721 nft_,
        uint256 tokenId_,
        IERC20 paymentToken_,
        uint256 startTime_,
        uint256 endTime_,
        uint256 minBid_,
        uint256 minIncrement_
    ) external returns (uint256 roundId) {
        // 外部可调用；返回新 roundId
        if (endTime_ <= startTime_) revert InvalidTimeRange();
        // 结束须晚于开始
        if (startTime_ > type(uint64).max || endTime_ > type(uint64).max) revert InvalidTimeRange();
        // 时间戳须能写入 uint64
        if (minBid_ == 0 || minIncrement_ == 0) revert InvalidMinBid();
        // 起拍价与加价幅度不能为 0

        roundId = roundCounter;
        // 当前 roundId
        unchecked {
            ++roundCounter;
        }
        // 计数器自增（unchecked 省 gas）

        Round storage r = _rounds[roundId];
        // 取得 storage 引用
        r.seller = msg.sender;
        // 创建者即卖家
        r.nft = nft_;
        // NFT 合约
        r.tokenId = tokenId_;
        // tokenId
        r.paymentToken = paymentToken_;
        // 支付代币（0 地址 = ETH）
        r.startTime = uint64(startTime_);
        // 开始时间
        r.endTime = uint64(endTime_);
        // 结束时间
        r.minBid = minBid_;
        // 首标下限
        r.minIncrement = minIncrement_;
        // 最小加价
        r.state = RoundState.Pending;
        // 初始 Pending

        emit RoundCreated(
            roundId,
            msg.sender,
            address(nft_),
            tokenId_,
            address(paymentToken_),
            startTime_,
            endTime_,
            minBid_,
            minIncrement_
        );
        // 发事件供索引
    }

    /// @notice 卖家托管 NFT 到本合约
    /// @dev 须在 endTime 之前调用（开拍后仍可补 deposit）；须事先 approve 或 setApprovalForAll
    /// @param roundId 轮次 id
    function depositItem(uint256 roundId) external {
        // 卖家托管 NFT
        Round storage r = _round(roundId);
        // 加载轮次
        if (msg.sender != r.seller) revert NotSeller();
        // 仅卖家
        if (r.itemDeposited) revert AlreadyDeposited();
        // 不可重复
        if (block.timestamp >= r.endTime) revert AuctionEnded();
        // 结束后不可再 deposit
        if (r.state != RoundState.Pending) revert InvalidRoundState();
        // 须 Pending

        r.itemDeposited = true;
        // 标记已托管
        r.nft.safeTransferFrom(r.seller, address(this), r.tokenId);
        // NFT 转入本合约

        emit ItemDeposited(roundId, r.seller, r.tokenId);
        // 发事件
    }

    /// @notice ETH 轮次出价
    /// @dev msg.value 必须等于 amount；被超越者的退款记入 pending，须 claimRefund 领取
    /// @param roundId 轮次 id
    /// @param amount 出价总额（wei）
    function bid(uint256 roundId, uint256 amount) external payable nonReentrant {
        // ETH 出价；amount 须与 msg.value 一致
        Round storage r = _round(roundId);
        // 加载轮次
        if (address(r.paymentToken) != address(0)) revert NoPaymentExpected();
        // 非 ETH 轮次禁止
        if (msg.value != amount) revert IncorrectPayment();
        // 防止多付 ETH 锁在合约
        _bid(r, roundId, amount, true);
        // 委托内部逻辑
    }

    /// @notice ERC20 轮次出价
    /// @dev 须事先 approve；按实际到账金额记账（兼容 fee-on-transfer）
    /// @param roundId 轮次 id
    /// @param amount 请求转入的代币数量
    function bidWithToken(uint256 roundId, uint256 amount) external payable nonReentrant {
        // ERC20 出价；payable 仅用于检查 msg.value
        Round storage r = _round(roundId);
        // 加载轮次
        if (address(r.paymentToken) == address(0)) revert EthPaymentExpected();
        // ETH 轮次禁止
        if (msg.value != 0) revert UnexpectedEth();
        // 禁止附带 ETH
        _bid(r, roundId, amount, false);
        // 委托内部逻辑
    }

    /// @notice 拍卖结束后标记轮次进入领取阶段
    /// @dev 任何人可调用；不转账，仅 state → Finalized
    /// @param roundId 轮次 id
    function finalizeRound(uint256 roundId) external nonReentrant {
        // 任何人可调用；只改状态
        Round storage r = _round(roundId);
        // 加载轮次
        if (r.state != RoundState.Pending) revert InvalidRoundState();
        // 须未终结
        if (block.timestamp < r.endTime) revert NotEnded();
        // 须已到 endTime
        if (!r.itemDeposited) revert NotDeposited();
        // 须已托管
        if (r.highestBidder == address(0)) revert NoBids();
        // 须有人出价

        r.state = RoundState.Finalized;
        // 进入 Pull 领取阶段

        emit RoundFinalized(roundId, r.highestBidder, r.highestBid);
        // 发事件
    }

    /// @notice 领取被超越后的待退款项（Pull）
    /// @dev 仅 msg.sender 自己的 pending；转账失败可重试
    /// @param roundId 轮次 id
    function claimRefund(uint256 roundId) external nonReentrant {
        // 仅领取自己的 pendingRefund
        Round storage r = _round(roundId);
        // 加载轮次（校验 id 有效）
        uint256 amount = _pendingRefunds[roundId][msg.sender];
        // 可读退款额
        if (amount == 0) revert NothingToClaim();
        // 无待领则 revert

        if (address(r.paymentToken) == address(0)) {
            // ETH 分支
            (bool ok, ) = msg.sender.call{value: amount}("");
            // Pull 转 ETH；失败由调用方重试
            if (!ok) revert TransferFailed();
            // 转账失败 revert（mapping 未清零，可再试）
        } else {
            // ERC20 分支
            r.paymentToken.safeTransfer(msg.sender, amount);
            // Pull 转代币
        }

        _pendingRefunds[roundId][msg.sender] = 0;
        // 转账成功后清零

        emit RefundClaimed(roundId, msg.sender, amount);
        // 发事件
    }

    /// @notice 卖家领取成交款（Pull）
    /// @dev 须已 finalize；拒收 ETH 时 revert，可换地址或重试
    /// @param roundId 轮次 id
    function claimProceeds(uint256 roundId) external nonReentrant {
        // Pull 结算：卖家主动领款
        Round storage r = _round(roundId);
        // 加载轮次
        if (r.state != RoundState.Finalized) revert InvalidRoundState();
        // 须已 finalize
        if (msg.sender != r.seller) revert NotSeller();
        // 仅卖家
        if (r.proceedsClaimed) revert AlreadyClaimed();
        // 不可重复领

        uint256 price = r.highestBid;
        // 缓存成交价
        r.proceedsClaimed = true;
        // 标记已领（CEI）

        if (address(r.paymentToken) == address(0)) {
            // ETH
            (bool ok, ) = r.seller.call{value: price}("");
            // 转卖家；拒收则 revert 可重试
            if (!ok) revert TransferFailed();
        } else {
            // ERC20
            r.paymentToken.safeTransfer(r.seller, price);
            // 转卖家
        }

        emit ProceedsClaimed(roundId, r.seller, price);
        // 发事件
        _maybeComplete(r, roundId);
        // 若 NFT 也已领则 → Settled
    }

    /// @notice 赢家领取 NFT（Pull）
    /// @dev 须已 finalize；仅 highestBidder 可调用
    /// @param roundId 轮次 id
    function claimItem(uint256 roundId) external nonReentrant {
        // Pull 结算：赢家主动领 NFT
        Round storage r = _round(roundId);
        // 加载轮次
        if (r.state != RoundState.Finalized) revert InvalidRoundState();
        // 须已 finalize
        if (msg.sender != r.highestBidder) revert NotWinner();
        // 仅最高出价者
        if (r.itemClaimed) revert AlreadyClaimed();
        // 不可重复领

        r.itemClaimed = true;
        // 标记已领（CEI）
        r.nft.safeTransferFrom(address(this), r.highestBidder, r.tokenId);
        // NFT 转赢家

        emit ItemClaimed(roundId, r.highestBidder, r.tokenId);
        // 发事件
        _maybeComplete(r, roundId);
        // 若款也已领则 → Settled
    }

    /// @notice 开拍前取消轮次
    /// @dev 仅 seller；须无出价；已 deposit 则 NFT 退回
    /// @param roundId 轮次 id
    function cancelRound(uint256 roundId) external nonReentrant {
        // 开拍前取消
        Round storage r = _round(roundId);
        // 加载轮次
        if (msg.sender != r.seller) revert NotSeller();
        // 仅卖家
        if (block.timestamp >= r.startTime) revert CannotCancel();
        // 开拍后不可取消
        if (r.highestBid != 0) revert HasBids();
        // 已有出价不可取消
        if (r.state != RoundState.Pending) revert InvalidRoundState();
        // 须 Pending

        r.state = RoundState.Cancelled;
        // 标记取消

        if (r.itemDeposited) {
            // 若已托管
            r.nft.safeTransferFrom(address(this), r.seller, r.tokenId);
            // 退回 NFT
        }

        emit RoundCancelled(roundId, r.seller);
        // 发事件
    }

    /// @notice 从未托管且已结束、无人出价的轮次标记取消
    /// @dev NFT 仍在卖家钱包，仅清理链上状态以便前端不再展示为进行中
    /// @param roundId 轮次 id
    function abortUndepositedRound(uint256 roundId) external nonReentrant {
        // 未 deposit 的废轮清理
        Round storage r = _round(roundId);
        // 加载轮次
        if (msg.sender != r.seller) revert NotSeller();
        // 仅卖家
        if (r.itemDeposited) revert AlreadyDeposited();
        // 须从未托管
        if (block.timestamp < r.endTime) revert NotEnded();
        // 须已结束
        if (r.highestBid != 0) revert HasBids();
        // 须无人出价
        if (r.state != RoundState.Pending) revert InvalidRoundState();
        // 须 Pending

        r.state = RoundState.Cancelled;
        // 标记取消

        emit RoundCancelled(roundId, r.seller);
        // 发事件
    }

    /// @notice 流拍后卖家取回 NFT
    /// @dev 须 endTime 已过且无人出价
    /// @param roundId 轮次 id
    function reclaim(uint256 roundId) external nonReentrant {
        // 流拍：结束且无人出价
        Round storage r = _round(roundId);
        // 加载轮次
        if (msg.sender != r.seller) revert NotSeller();
        // 仅卖家
        if (!r.itemDeposited) revert NotDeposited();
        // 须已托管
        if (block.timestamp < r.endTime) revert NotEnded();
        // 须已结束
        if (r.highestBidder != address(0)) revert HasBids();
        // 须无人出价
        if (r.state != RoundState.Pending) revert InvalidRoundState();
        // 须未终结

        r.state = RoundState.Expired;
        // 标记流拍

        r.nft.safeTransferFrom(address(this), r.seller, r.tokenId);
        // NFT 退回卖家

        emit RoundReclaimed(roundId, r.seller, r.tokenId);
        // 发事件
    }

    /// @notice 查询某地址在某轮的待领退款
    /// @param roundId 轮次 id
    /// @param account 查询地址
    /// @return 待领金额（ETH wei 或 ERC20 最小单位）
    function pendingRefund(uint256 roundId, address account) external view returns (uint256) {
        // 只读：某地址在某轮待领退款
        if (roundId >= roundCounter) return 0;
        // 无效 id 返回 0
        return _pendingRefunds[roundId][account];
        // 返回 pending 金额
    }

    /// @notice 读取单轮完整信息
    /// @dev state 经 _effectiveState 推导（Pending 在时间窗内显示 Active）
    /// @param roundId 轮次 id
    /// @return seller 卖家地址
    /// @return nft NFT 合约地址
    /// @return tokenId tokenId
    /// @return paymentToken 支付代币（0 = ETH）
    /// @return startTime 开拍时间
    /// @return endTime 结束时间
    /// @return minBid 首标下限
    /// @return minIncrement 最小加价
    /// @return highestBidder 当前最高出价者
    /// @return highestBid 当前最高出价
    /// @return itemDeposited 是否已托管
    /// @return state 有效状态
    /// @return proceedsClaimed 卖家是否已领款
    /// @return itemClaimed 赢家是否已领 NFT
    function getRound(uint256 roundId)
        external
        view
        returns (
            address seller,
            address nft,
            uint256 tokenId,
            address paymentToken,
            uint256 startTime,
            uint256 endTime,
            uint256 minBid,
            uint256 minIncrement,
            address highestBidder,
            uint256 highestBid,
            bool itemDeposited,
            RoundState state,
            bool proceedsClaimed,
            bool itemClaimed
        )
    {
        // 只读：返回单轮全部字段
        Round storage r = _round(roundId);
        // 加载轮次
        return (
            r.seller,
            address(r.nft),
            r.tokenId,
            address(r.paymentToken),
            r.startTime,
            r.endTime,
            r.minBid,
            r.minIncrement,
            r.highestBidder,
            r.highestBid,
            r.itemDeposited,
            _effectiveState(r),
            r.proceedsClaimed,
            r.itemClaimed
        );
        // state 用有效状态；uint64 时间自动拓宽
    }

    /// @notice 当前时刻是否允许出价
    /// @param roundId 轮次 id
    /// @return 可出价则为 true
    function isBiddable(uint256 roundId) external view returns (bool) {
        // 只读：当前可否出价
        Round storage r = _rounds[roundId];
        // 直接读 mapping（无效 id 不 revert）
        if (roundId >= roundCounter) return false;
        // id 超范围
        if (!r.itemDeposited) return false;
        // 未托管
        if (r.state != RoundState.Pending) return false;
        // 已 finalize / 取消等
        if (block.timestamp < r.startTime || block.timestamp >= r.endTime) return false;
        // 不在时间窗
        return true;
        // 全部通过
    }

    /// @dev 内部统一出价：校验 → 收款的 → 记 pending 退款 → 更新最高价
    /// @param r 轮次 storage 引用
    /// @param roundId 轮次 id（用于 mapping 与事件）
    /// @param amount 出价金额（ETH 为 wei；ERC20 可能按实收修正）
    /// @param isEth true=ETH 轮次，false=ERC20
    function _bid(Round storage r, uint256 roundId, uint256 amount, bool isEth) private {
        // 内部：统一 ETH/ERC20 出价
        _requireBiddable(r);
        // 校验可出价
        _requireMinBid(r, amount);
        // 校验金额下限

        if (!isEth) {
            // ERC20：按实际到账记账（兼容 fee-on-transfer）
            IERC20 pay = r.paymentToken;
            // 缓存代币合约
            uint256 balBefore = pay.balanceOf(address(this));
            // 转账前余额
            pay.safeTransferFrom(msg.sender, address(this), amount);
            // 从出价者拉取
            amount = pay.balanceOf(address(this)) - balBefore;
            // 实收增量作为有效出价
            _requireMinBid(r, amount);
            // 用实收再校验一次
        }

        address prevBidder = r.highestBidder;
        // 上一名出价者
        uint256 prevAmount = r.highestBid;
        // 上一名金额

        if (prevBidder != address(0)) {
            // 存在上一名：Pull 退款，不 push
            _pendingRefunds[roundId][prevBidder] += prevAmount;
            // 累加待领退款
            emit RefundAccrued(roundId, prevBidder, prevAmount);
            // 发事件
        }

        r.highestBidder = msg.sender;
        // 更新最高出价者
        r.highestBid = amount;
        // 更新最高出价额

        emit BidPlaced(roundId, msg.sender, amount);
        // 发新出价事件
    }

    /// @dev 校验 amount 是否满足首标或加价规则
    /// @param r 轮次 storage
    /// @param amount 待校验金额
    function _requireMinBid(Round storage r, uint256 amount) private view {
        // 内部：校验出价是否足够
        if (r.highestBid == 0) {
            // 首标
            if (amount < r.minBid) revert BidTooLow();
            // 须 ≥ minBid
        } else {
            // 加价
            uint256 minNext;
            unchecked {
                minNext = r.highestBid + r.minIncrement;
            }
            // 下一口价（unchecked 省 gas）
            if (amount < minNext) revert BidTooLow();
            // 须 ≥ 最高价 + 增量
        }
    }

    /// @dev 款、货均领取后将 state 置为 Settled
    /// @param r 轮次 storage
    /// @param roundId 轮次 id
    function _maybeComplete(Round storage r, uint256 roundId) private {
        // 内部：款、货均领完则置 Settled
        if (r.proceedsClaimed && r.itemClaimed) {
            // 两者都已领取
            r.state = RoundState.Settled;
            // 终态
            emit RoundCompleted(roundId, r.highestBidder, r.highestBid);
            // 发完结事件
        }
    }

    /// @dev 按 roundId 取 Round storage；无效 id revert RoundNotFound
    /// @param roundId 轮次 id
    /// @return r 轮次 storage 指针
    function _round(uint256 roundId) private view returns (Round storage r) {
        // 内部：带 bounds 的轮次引用
        if (roundId >= roundCounter) revert RoundNotFound();
        // 无效 id
        r = _rounds[roundId];
        // 返回 storage 指针
    }

    /// @dev 出价前校验：已托管、Pending、在时间窗内
    /// @param r 轮次 storage
    function _requireBiddable(Round storage r) private view {
        // 内部：出价前校验
        if (!r.itemDeposited) revert NotDeposited();
        // 须托管
        if (r.state != RoundState.Pending) revert InvalidRoundState();
        // 须未 finalize
        if (block.timestamp < r.startTime) revert AuctionNotStarted();
        // 须已开始
        if (block.timestamp >= r.endTime) revert AuctionEnded();
        // 须未结束
    }

    /// @dev 链上存 Pending 时，按时间推导 Active 展示态
    /// @param r 轮次 storage
    /// @return 对外展示的状态
    function _effectiveState(Round storage r) private view returns (RoundState) {
        // 内部：推导对外展示状态
        if (r.state != RoundState.Pending) return r.state;
        // 已写入终态则直接返回
        if (block.timestamp >= r.startTime && block.timestamp < r.endTime) {
            return RoundState.Active;
        }
        // 时间窗内视为 Active
        return RoundState.Pending;
        // 否则仍 Pending
    }
}
