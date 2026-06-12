// SPDX-License-Identifier: MIT
// 开源许可证 MIT
pragma solidity ^0.8.30;
// Solidity 编译器版本

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// ERC20 接口：质押代币与奖励代币

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// 安全转账：兼容非标准 ERC20 返回值

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
// 防重入：stake / withdraw / getReward 等涉及外部代币转账

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
// 管理员：注入奖励、调整周期、回收误转代币

/// @title StakingRewards
/// @notice 经典 Synthetix 风格质押挖矿：质押 A 代币，按份额与时间线性分配 B 代币奖励。
/// @dev rewardPerToken 全局累加器 + 用户 checkpoint；notifyRewardAmount 由 rewardsDistribution 注入奖励。
contract StakingRewards is ReentrancyGuard, Ownable {
    // 继承：防重入 + 单 owner 管理

    using SafeERC20 for IERC20;
    // 为 IERC20 绑定 safeTransfer / safeTransferFrom

    /// @dev 精度缩放：rewardPerToken 用 1e18 避免整数除法丢精度
    uint256 public constant PRECISION = 1e18;

    /// @notice 奖励代币（用户领取的 ERC20）
    IERC20 public immutable rewardsToken;
    // 不可变：部署后奖励币种固定

    /// @notice 质押代币（用户存入的 ERC20）
    IERC20 public immutable stakingToken;
    // 不可变：部署后质押币种固定

    /// @notice 有权调用 notifyRewardAmount 的地址（可与 owner 分离）
    address public rewardsDistribution;
    // 奖励分发员：通常为多签或运营钱包

    /// @notice 单轮奖励持续秒数（默认 7 天，可由 owner 在空闲期调整）
    uint256 public rewardsDuration;
    // 每轮奖励线性释放的时间窗口

    /// @notice 当前轮次结束时间戳（block.timestamp >= periodFinish 表示无活跃奖励）
    uint256 public periodFinish;
    // 奖励周期截止时刻

    /// @notice 每秒向全体质押者释放的奖励代币数量
    uint256 public rewardRate;
    // rewardRate = 本轮总奖励 / rewardsDuration（含滚存 leftover）

    /// @notice 上次更新 rewardPerTokenStored 的时间戳
    uint256 public lastUpdateTime;
    // 与 lastTimeRewardApplicable 配合计算新增奖励

    /// @notice 累计每单位质押代币应得奖励（放大 PRECISION 倍）
    uint256 public rewardPerTokenStored;
    // 全局指数：用户 earned = balance * (rewardPerToken - paid) / PRECISION + rewards

    /// @notice 全网质押代币总量
    uint256 public totalSupply;
    // 所有用户 balanceOf 之和

    /// @dev 用户质押余额
    mapping(address account => uint256 balance) public balanceOf;
    // 各地址当前质押量

    /// @dev 用户上次结算时的 rewardPerToken 快照
    mapping(address account => uint256 paid) public userRewardPerTokenPaid;
    // checkpoint：防止重复计提

    /// @dev 用户已结算、待领取的奖励余额
    mapping(address account => uint256 amount) public rewards;
    // getReward 时转出并清零

    /// @dev 质押数量为零
    error ZeroAmount();
    // stake / withdraw 传入 0

    /// @dev 奖励注入量为零
    error ZeroReward();
    // notifyRewardAmount(0)

    /// @dev 奖励速率计算为 0（奖励过小或 duration 过大）
    error InvalidRewardRate();
    // reward / duration 向下取整为 0

    /// @dev 奖励周期进行中，禁止修改 duration
    error RewardPeriodActive();
    // setRewardsDuration 时 period 未结束

    /// @dev 非 rewardsDistribution 调用 notifyRewardAmount
    error NotRewardsDistribution();
    // 权限校验

    /// @dev 尝试回收质押币或奖励币
    error CannotRecoverStakingOrRewardToken();
    // recoverERC20 保护核心资产

    /// @notice 用户质押代币
    /// @param user 质押者
    /// @param amount 质押数量
    event Staked(address indexed user, uint256 amount);

    /// @notice 用户取回质押代币
    /// @param user 取回者
    /// @param amount 取回数量
    event Withdrawn(address indexed user, uint256 amount);

    /// @notice 用户领取奖励代币
    /// @param user 领取者
    /// @param reward 领取数量
    event RewardPaid(address indexed user, uint256 reward);

    /// @notice 新一轮奖励已注入
    /// @param reward 本轮新增奖励量（不含滚存 leftover 的计量在链上合并进 rewardRate）
    event RewardAdded(uint256 reward);

    /// @notice 奖励分发员地址变更
    /// @param newDistribution 新分发员
    event RewardsDistributionUpdated(address indexed newDistribution);

    /// @notice 奖励周期秒数变更
    /// @param newDuration 新周期长度
    event RewardsDurationUpdated(uint256 newDuration);

    /// @notice 部署质押奖励合约
    /// @param owner_ 管理员（ Ownable ）
    /// @param rewardsToken_ 奖励 ERC20 地址
    /// @param stakingToken_ 质押 ERC20 地址
    /// @param rewardsDistribution_ 初始奖励分发员（可传 owner_）
    constructor(
        address owner_,
        address rewardsToken_,
        address stakingToken_,
        address rewardsDistribution_
    ) Ownable(owner_) {
        if (rewardsToken_ == address(0) || stakingToken_ == address(0)) revert ZeroAmount();
        // 禁止零地址代币
        if (rewardsDistribution_ == address(0)) revert ZeroAmount();
        // 分发员须有效

        rewardsToken = IERC20(rewardsToken_);
        stakingToken = IERC20(stakingToken_);
        rewardsDistribution = rewardsDistribution_;
        rewardsDuration = 7 days;
        // 默认一轮 7 天
    }

    /// @notice 当前可用于计息的截止时间（未结束取 now，已结束取 periodFinish）
    /// @return 计息上限时间戳
    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
        // 周期结束后不再累加 rewardPerToken
    }

    /// @notice 当前每单位质押代币累计奖励（含 PRECISION 缩放）
    /// @return 全局 rewardPerToken 值
    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) {
            return rewardPerTokenStored;
            // 无人质押时不做除法，避免除零
        }
        return rewardPerTokenStored
            + (
                (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * PRECISION
            ) / totalSupply;
        // 自上次更新以来，每秒 rewardRate 奖励平摊到每 1 单位质押
    }

    /// @notice 某用户当前应得奖励（含未领取的 rewards 余额）
    /// @param account 用户地址
    /// @return 可领取奖励总量
    function earned(address account) public view returns (uint256) {
        return (
            balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account])
        ) / PRECISION + rewards[account];
        // 新增应计 + 历史已结算未领取
    }

    /// @notice 质押代币参与挖矿
    /// @dev 先 updateReward 结算旧奖励，再 safeTransferFrom 拉取代币
    /// @param amount 质押数量（须 > 0）
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        // 禁止空质押

        totalSupply += amount;
        balanceOf[msg.sender] += amount;
        // CEI：先更新状态

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        // 再从用户钱包拉取质押币

        emit Staked(msg.sender, amount);
    }

    /// @notice 取回部分或全部质押代币
    /// @param amount 取回数量（须 > 0 且 <= balanceOf）
    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();

        totalSupply -= amount;
        balanceOf[msg.sender] -= amount;
        // 先扣减质押账本

        stakingToken.safeTransfer(msg.sender, amount);
        // 返还质押代币

        emit Withdrawn(msg.sender, amount);
    }

    /// @notice 领取累计奖励代币
    /// @return reward 本次领取数量
    function getReward() public nonReentrant updateReward(msg.sender) returns (uint256 reward) {
        reward = rewards[msg.sender];
        if (reward == 0) {
            return 0;
            // 无奖励则跳过转账，节省 gas
        }

        rewards[msg.sender] = 0;
        // 先清零待领余额

        rewardsToken.safeTransfer(msg.sender, reward);
        // 转出奖励币

        emit RewardPaid(msg.sender, reward);
    }

    /// @notice 一次性取回全部质押并领取奖励
    function exit() external {
        withdraw(balanceOf[msg.sender]);
        // 取回全部质押
        getReward();
        // 领取全部奖励
    }

    /// @notice 注入新一轮奖励（须预 approve 或将代币转入本合约后由分发员调用）
    /// @dev 若上一轮未结束，未发完的奖励滚入下一轮；从 msg.sender 拉取 reward 数量代币
    /// @param reward 本轮新增奖励代币数量
    function notifyRewardAmount(uint256 reward)
        external
        nonReentrant
        updateReward(address(0))
        returns (uint256 newRewardRate)
    {
        if (msg.sender != rewardsDistribution) revert NotRewardsDistribution();
        if (reward == 0) revert ZeroReward();

        rewardsToken.safeTransferFrom(msg.sender, address(this), reward);
        // 从分发员账户拉取奖励代币

        if (block.timestamp >= periodFinish) {
            rewardRate = reward / rewardsDuration;
            // 新周期：速率 = 总奖励 / 周期
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            // 旧周期剩余未释放量
            rewardRate = (reward + leftover) / rewardsDuration;
            // 滚存 + 新奖励，重新按完整 duration 摊销
        }

        if (rewardRate == 0) revert InvalidRewardRate();
        // 防止 reward 过小导致无释放

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;
        // 重置周期终点

        emit RewardAdded(reward);
        return rewardRate;
    }

    /// @notice 更新奖励分发员地址
    /// @param newDistribution 新地址
    function setRewardsDistribution(address newDistribution) external onlyOwner {
        if (newDistribution == address(0)) revert ZeroAmount();
        rewardsDistribution = newDistribution;
        emit RewardsDistributionUpdated(newDistribution);
    }

    /// @notice 更新奖励周期长度（仅当当前无活跃周期时可调）
    /// @param newDuration 新周期秒数（须 > 0）
    function setRewardsDuration(uint256 newDuration) external onlyOwner {
        if (newDuration == 0) revert ZeroAmount();
        if (block.timestamp <= periodFinish) revert RewardPeriodActive();
        rewardsDuration = newDuration;
        emit RewardsDurationUpdated(newDuration);
    }

    /// @notice 回收误转入本合约的其他 ERC20（不含质押币与奖励币）
    /// @param tokenAddress 代币合约地址
    /// @param tokenAmount 回收数量
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        if (tokenAddress == address(stakingToken) || tokenAddress == address(rewardsToken)) {
            revert CannotRecoverStakingOrRewardToken();
        }
        IERC20(tokenAddress).safeTransfer(owner(), tokenAmount);
    }

    /// @dev 在用户交互前刷新全局与用户奖励 checkpoint
    /// @param account 要更新的用户；address(0) 表示仅刷新全局（notify 时用）
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        // 将 view 计算结果写入存储
        lastUpdateTime = lastTimeRewardApplicable();
        // 推进全局时间戳

        if (account != address(0)) {
            rewards[account] = earned(account);
            // 把应计奖励固化到 rewards 映射
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
            // 更新用户 checkpoint
        }
        _;
    }
}
