// SPDX-License-Identifier: MIT
// 开源许可证标识：MIT，允许他人自由使用、修改与分发（需保留版权声明）

pragma solidity ^0.8.30;
// 指定 Solidity 编译器最低版本为 0.8.30（与 hardhat.config 一致）

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
// 引入 OpenZeppelin 重入锁：通过 nonReentrant 修饰符防止重入攻击

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
// 引入 EIP-712 结构化数据签名标准，用于链下多签 digest 构造与验证

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
// 引入 ECDSA 签名恢复工具，从签名中还原 signer 地址

/// @title MultisigWallet
/// @notice M-of-N 多签钱包示例：支持链上确认执行与 EIP-712 链下签名一次性执行。
/// @dev 安全：CEI + nonReentrant + 执行失败 bubbling revert；owner 变更时同步清理待执行交易的确认。
///      Gas：custom error、calldata、执行前短路校验；链下签名路径避免多次 confirm 上链。
contract MultisigWallet is ReentrancyGuard, EIP712 {
    // 合约继承：重入保护 + EIP-712 域分隔与类型化哈希

    using ECDSA for bytes32;
    // 为 bytes32 附加库方法：digest.recover(signature) 等价于 ECDSA.recover(digest, signature)

    /// @dev EIP-712 结构体类型哈希；data 在签名时用 keccak256(data) 而非原始 bytes
    bytes32 private constant TX_TYPEHASH =
        keccak256("WalletTransaction(address to,uint256 value,bytes32 dataHash,uint256 nonce,uint256 deadline)");
    // 编译期常量：EIP-712 typehash，必须与链下 signTypedData 的字段类型、顺序一致

    uint256 public constant MAX_OWNERS = 50;
    // 公开常量：owner 数量上限，防止 gas 与循环成本失控

    address[] private _owners;
    // 私有动态数组：当前全部 owner 地址列表

    /// @dev owner 地址 → 1-based 下标；0 表示非 owner
    mapping(address => uint256) private _ownerIndex;
    // 私有映射：O(1) 判断某地址是否为 owner，并支持 swap-and-pop 删除

    uint256 public threshold;
    // 公开变量：执行一笔交易所需的最少有效确认数（M-of-N 中的 M）

    /// @dev 链下签名路径专用 nonce，每成功执行一次 executeWithSignatures 自增 1
    uint256 public walletNonce;
    // 公开变量：防 EIP-712 签名重放；与链上 _transactions 的 txId 无关

    struct Transaction {
        // 链上多签流程中「待执行交易」的数据结构
        address to;
        // 调用目标地址（可为 EOA 或合约）
        uint256 value;
        // 随 call 发送的 ETH 数量（wei）
        bytes data;
        // 调用 calldata；空字节表示纯转账
        address proposer;
        // 提交该交易的 owner，用于取消权限判断
        uint256 confirmationCount;
        // 当前已确认人数（与 _confirmations 映射保持同步）
        uint48 deadline;
        // 过期时间戳；0 表示永不过期
        bool executed;
        // 是否已终结（已执行或已取消均为 true）
    }

    Transaction[] private _transactions;
    // 私有动态数组：全部已提交交易的存储，下标即 txId

    mapping(uint256 => mapping(address => bool)) private _confirmations;
    // 嵌套映射：txId → owner 地址 → 是否已确认

    // ─── errors（custom error，比 require 字符串更省 gas）────────────────────
    error ZeroAddress();
    // 不允许零地址作为 owner、目标 to 或 newOwner
    error InvalidThreshold();
    // threshold 为 0 或大于 owner 数量
    error TooManyOwners();
    // owner 数量超过 MAX_OWNERS
    error DuplicateOwner();
    // 构造函数中 owners 列表出现重复地址
    error NotOwner();
    // msg.sender 不在 owner 列表中
    error NotSelf();
    // 治理函数要求 msg.sender 必须是本合约自身（仅能通过多签 call 触发）
    error OwnerExists();
    // addOwner / swapOwner 时新地址已是 owner
    error OwnerNotFound();
    // removeOwner 目标不是 owner
    error LastOwner();
    // 试图移除最后一个 owner（钱包不允许无主）
    error BelowThreshold();
    // removeOwner 后 threshold 大于剩余 owner 数
    error TxNotExists();
    // txId 超出 _transactions 长度
    error TxAlreadyExecuted();
    // 交易已执行或已取消，不可再确认/执行
    error TxExpired();
    // 当前时间已超过交易的 deadline
    error TxNotExpired();
    // 预留：未过期时不允许以「过期清理」逻辑操作（当前合约未使用）
    error AlreadyConfirmed();
    // 同一 owner 对同一 txId 重复 confirm
    error NotConfirmed();
    // revoke 时该 owner 尚未 confirm
    error TxNotConfirmed();
    // 执行时 confirmationCount 仍小于 threshold
    error NotProposer();
    // 非 proposer 在交易未过期时尝试 cancel
    error ExecutionFailed(bytes reason);
    // 外部 call 失败且无可 bubble 的 returndata 时使用
    error InvalidSigner();
    // EIP-712 恢复出的地址不是 owner
    error UnorderedSigners();
    // 链下签名未按 signer 地址严格升序排列（防同一签名被重复计数）
    error InsufficientSignatures();
    // 提供的签名数量少于 threshold，或有效 owner 签名不足

    // ─── events（链下索引与前端展示）────────────────────────────────────────
    event Deposit(address indexed sender, uint256 amount);
    // 有人向钱包转入 ETH（含 receive）
    event SubmitTransaction(
        uint256 indexed txId,
        address indexed proposer,
        address indexed to,
        uint256 value,
        bytes data,
        uint48 deadline
    );
    // 新交易进入待确认队列
    event ConfirmTransaction(uint256 indexed txId, address indexed owner);
    // 某 owner 确认交易
    event RevokeConfirmation(uint256 indexed txId, address indexed owner);
    // 某 owner 撤销确认
    event ExecuteTransaction(uint256 indexed txId, address indexed executor);
    // 链上确认路径成功执行
    event CancelTransaction(uint256 indexed txId, address indexed canceller);
    // 交易被取消（标记 executed，不执行 call）
    event ExecuteWithSignatures(
        address indexed executor,
        address indexed to,
        uint256 value,
        uint256 nonce,
        bytes data
    );
    // 链下 EIP-712 路径成功执行
    event OwnerAdded(address indexed owner);
    // 治理：新增 owner
    event OwnerRemoved(address indexed owner);
    // 治理：移除 owner
    event ThresholdChanged(uint256 threshold);
    // 治理：修改 threshold

    modifier onlyOwner() {
        // 修饰符：仅 owner 可调用
        if (_ownerIndex[msg.sender] == 0) revert NotOwner();
        // 查映射，0 表示非 owner
        _;
        // 继续执行被修饰函数体
    }

    modifier onlySelf() {
        // 修饰符：仅允许本合约作为 msg.sender（多签执行内部 call）
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    modifier txExists(uint256 txId) {
        // 修饰符：txId 必须对应已存在的交易
        if (txId >= _transactions.length) revert TxNotExists();
        _;
    }

    modifier notExecuted(uint256 txId) {
        // 修饰符：交易尚未终结
        if (_transactions[txId].executed) revert TxAlreadyExecuted();
        _;
    }

    /// @param owners_ 初始 owner 列表（不可重复、不可零地址）
    /// @param threshold_ 执行交易所需最少确认数（1 <= threshold <= owners.length）
    constructor(address[] memory owners_, uint256 threshold_) EIP712("MultisigWallet", "1") {
        // 构造函数：初始化 EIP-712 域名 "MultisigWallet" / 版本 "1"
        if (threshold_ == 0 || threshold_ > owners_.length) revert InvalidThreshold();
        // threshold 至少为 1，且不能超过 owner 总数
        if (owners_.length > MAX_OWNERS) revert TooManyOwners();
        // owner 数量硬上限

        for (uint256 i = 0; i < owners_.length; ++i) {
            // 遍历部署时传入的每一个 owner
            address owner = owners_[i];
            if (owner == address(0)) revert ZeroAddress();
            // 禁止零地址 owner
            if (_ownerIndex[owner] != 0) revert DuplicateOwner();
            // 禁止列表内重复

            _owners.push(owner);
            // 写入 owner 数组
            _ownerIndex[owner] = i + 1;
            // 记录 1-based 索引（与数组下标 i 对应：下标 i → 存储 i+1）
        }

        threshold = threshold_;
        // 写入全局确认阈值
    }

    receive() external payable {
        // 接收纯 ETH 转账（无 calldata）的入口
        emit Deposit(msg.sender, msg.value);
        // 发出存款事件，便于链下记账
    }

    // ─── views（只读查询，不消耗状态变更 gas 以外的链上写入）────────────────

    function getOwners() external view returns (address[] memory) {
        // 返回当前全部 owner 地址副本
        return _owners;
    }

    function getTransactionCount() external view returns (uint256) {
        // 返回历史提交交易总数（含已执行/已取消）
        return _transactions.length;
    }

    function isOwner(address account) external view returns (bool) {
        // 查询某地址是否为 owner
        return _ownerIndex[account] != 0;
    }

    function isConfirmed(uint256 txId, address owner) external view txExists(txId) returns (bool) {
        // 查询某 owner 是否已确认指定 txId
        return _confirmations[txId][owner];
    }

    function getTransaction(uint256 txId)
        external
        view
        txExists(txId)
        returns (
            address to,
            uint256 value,
            bytes memory data,
            address proposer,
            uint256 confirmationCount,
            uint48 deadline,
            bool executed
        )
    {
        // 按 txId 返回交易的全部字段（data 会拷贝到 memory，大 calldata 查询较贵）
        Transaction storage txn = _transactions[txId];
        // 获取 storage 引用，避免多次索引
        return (txn.to, txn.value, txn.data, txn.proposer, txn.confirmationCount, txn.deadline, txn.executed);
    }

    /// @notice 供链下签名客户端构造 EIP-712 digest（与 executeWithSignatures 使用同一公式）
    function hashTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint256 nonce,
        uint256 deadline
    ) external view returns (bytes32) {
        bytes32 structHash =
            keccak256(abi.encode(TX_TYPEHASH, to, value, keccak256(data), nonce, deadline));
        // 先算 EIP-712 structHash：bytes 字段以 keccak256(data) 参与
        return _hashTypedDataV4(structHash);
        // 再套上域分隔符，得到最终 signTypedData 的 digest
    }

    // ─── 链上多签流程（每笔 confirm 都是一次独立交易）────────────────────────

    /// @notice 提议一笔待执行交易；deadline=0 表示永不过期
    function submitTransaction(address to, uint256 value, bytes calldata data, uint48 deadline)
        external
        onlyOwner
        returns (uint256 txId)
    {
        if (to == address(0)) revert ZeroAddress();
        // 禁止向零地址转账/调用

        txId = _transactions.length;
        // 新交易 id = 当前数组长度（从 0 递增）
        _transactions.push(
            Transaction({
                to: to,
                value: value,
                data: data,
                proposer: msg.sender,
                confirmationCount: 0,
                deadline: deadline,
                executed: false
            })
        );
        // 将完整交易写入 storage；calldata data 拷贝进 storage

        emit SubmitTransaction(txId, msg.sender, to, value, data, deadline);
    }

    /// @notice 确认待执行交易
    function confirmTransaction(uint256 txId) external onlyOwner txExists(txId) notExecuted(txId) {
        Transaction storage txn = _transactions[txId];
        if (txn.deadline != 0 && block.timestamp > txn.deadline) revert TxExpired();
        // 已过期的交易不能再确认
        if (_confirmations[txId][msg.sender]) revert AlreadyConfirmed();
        // 同一 owner 不能重复确认

        _confirmations[txId][msg.sender] = true;
        // 在映射中记录确认
        unchecked {
            ++txn.confirmationCount;
        }
        // 确认计数 +1；Solidity 0.8+ 默认溢出检查，此处已防重复故用 unchecked 省 gas

        emit ConfirmTransaction(txId, msg.sender);
    }

    /// @notice 撤销确认（仅未执行交易）
    function revokeConfirmation(uint256 txId) external onlyOwner txExists(txId) notExecuted(txId) {
        if (!_confirmations[txId][msg.sender]) revert NotConfirmed();
        // 未确认则不能撤销

        _confirmations[txId][msg.sender] = false;
        // 清除确认标记
        unchecked {
            --_transactions[txId].confirmationCount;
        }
        // 确认计数 -1

        emit RevokeConfirmation(txId, msg.sender);
    }

    /// @notice 确认数达到 threshold 后执行；CEI：先标记 executed 再外部 call
    function executeTransaction(uint256 txId)
        external
        onlyOwner
        nonReentrant
        txExists(txId)
        notExecuted(txId)
    {
        Transaction storage txn = _transactions[txId];
        if (txn.deadline != 0 && block.timestamp > txn.deadline) revert TxExpired();
        // 过期不能执行
        if (txn.confirmationCount < threshold) revert TxNotConfirmed();
        // 确认数不足不能执行

        txn.executed = true;
        // CEI-Effects：先标记已终结，再外部交互（配合 nonReentrant 防重入）
        _execute(txn.to, txn.value, txn.data);
        // CEI-Interactions：低级 call 目标合约或转账

        emit ExecuteTransaction(txId, msg.sender);
    }

    /// @notice 取消未执行交易：提议者可随时取消；过期后任意 owner 可清理
    function cancelTransaction(uint256 txId) external onlyOwner txExists(txId) notExecuted(txId) {
        Transaction storage txn = _transactions[txId];
        if (msg.sender != txn.proposer) {
            // 非提议者须满足「已过期」才能取消
            if (txn.deadline == 0 || block.timestamp <= txn.deadline) revert NotProposer();
            // deadline=0 永不过期 → 只有 proposer 能取消
        }

        txn.executed = true;
        // 标记为已终结，但不执行 call（与执行成功区分靠事件 Cancel vs Execute）
        emit CancelTransaction(txId, msg.sender);
    }

    // ─── EIP-712 链下签名执行（一次上链，省多次 confirm 的 gas）──────────────

    /// @notice 收集足够 owner 的 EIP-712 签名后一次执行；签名地址须严格递增以防重复计数
    function executeWithSignatures(
        address to,
        uint256 value,
        bytes calldata data,
        uint256 deadline,
        bytes[] calldata signatures
    ) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert TxExpired();
        // 链下路径 deadline 必填且须未过期（与 submit 中 deadline=0 语义不同）
        if (signatures.length < threshold) revert InsufficientSignatures();
        // 签名数组长度至少达到 threshold

        uint256 nonce = walletNonce;
        // 读取当前 nonce，纳入 digest 防重放
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(TX_TYPEHASH, to, value, keccak256(data), nonce, deadline))
        );
        // 构造与 hashTransaction 一致的 EIP-712 最终哈希

        address lastSigner = address(0);
        // 上一个已通过校验的 signer，用于强制地址升序
        uint256 validCount;
        // 已验证的有效 owner 签名数量

        for (uint256 i = 0; i < signatures.length && validCount < threshold; ++i) {
            // 遍历签名；凑满 threshold 个有效签名即可提前结束循环省 gas
            address signer = digest.recover(signatures[i]);
            // 从第 i 个签名恢复出 signer 地址
            if (signer <= lastSigner) revert UnorderedSigners();
            // 要求严格递增，防止同一人签两次或乱序重复计数
            if (_ownerIndex[signer] == 0) revert InvalidSigner();
            // 恢复地址必须是 owner
            lastSigner = signer;
            unchecked {
                ++validCount;
            }
        }

        if (validCount < threshold) revert InsufficientSignatures();
        // 例如签名无效、非 owner 导致循环结束仍未凑满 threshold

        unchecked {
            ++walletNonce;
        }
        // 执行前消耗 nonce，防止同一批签名被重复提交

        _execute(to, value, data);
        emit ExecuteWithSignatures(msg.sender, to, value, nonce, data);
        // 事件中 nonce 为执行前取值，便于链下对账
    }

    // ─── 治理（仅多签自身调用：须先 submit → confirm → execute 调本合约）────

    function addOwner(address newOwner) external onlySelf {
        if (newOwner == address(0)) revert ZeroAddress();
        if (_ownerIndex[newOwner] != 0) revert OwnerExists();
        if (_owners.length >= MAX_OWNERS) revert TooManyOwners();

        _owners.push(newOwner);
        _ownerIndex[newOwner] = _owners.length;
        // 新 owner 的 1-based 索引 = 当前数组长度

        emit OwnerAdded(newOwner);
    }

    function removeOwner(address owner) external onlySelf {
        _removeOwner(owner);
        // 委托内部函数，便于 swapOwner 复用
    }

    function changeThreshold(uint256 newThreshold) external onlySelf {
        if (newThreshold == 0 || newThreshold > _owners.length) revert InvalidThreshold();
        threshold = newThreshold;
        emit ThresholdChanged(newThreshold);
    }

    /// @notice 原子替换 owner 并更新 threshold（一笔治理交易完成换人+改阈值）
    function swapOwner(address oldOwner, address newOwner, uint256 newThreshold) external onlySelf {
        if (newOwner == address(0)) revert ZeroAddress();
        if (_ownerIndex[newOwner] != 0) revert OwnerExists();
        if (newThreshold == 0) revert InvalidThreshold();

        _removeOwner(oldOwner);
        // 先删旧 owner（会清理其在待执行交易上的确认）

        if (newThreshold > _owners.length) revert InvalidThreshold();
        // 删除后 _owners.length 已减 1，此处校验新 threshold 对剩余+即将加入的 owner 合法
        threshold = newThreshold;

        _owners.push(newOwner);
        _ownerIndex[newOwner] = _owners.length;

        emit OwnerAdded(newOwner);
        emit ThresholdChanged(newThreshold);
    }

    // ─── internal（仅合约内部调用）──────────────────────────────────────────

    function _execute(address to, uint256 value, bytes memory data) private {
        // 统一的底层执行：ETH 转账 + 任意合约调用
        (bool success, bytes memory returndata) = to.call{value: value}(data);
        // 低级 call：不检查 to 是否有代码；失败时 success=false 且 returndata 可能含 revert 原因
        if (!success) {
            if (returndata.length > 0) {
                assembly {
                    // returndata 内存布局：[length(32字节)][实际数据...]
                    revert(add(returndata, 32), mload(returndata))
                    // 用内层 revert 的原始字节 bubble 给调用方（add 跳过长度字，mload 取长度）
                }
            }
            revert ExecutionFailed(returndata);
            // 内层无返回数据时，回退到本合约自定义错误
        }
    }

    function _removeOwner(address owner) private {
        uint256 indexPlusOne = _ownerIndex[owner];
        if (indexPlusOne == 0) revert OwnerNotFound();
        if (_owners.length == 1) revert LastOwner();
        // 至少保留 1 个 owner

        uint256 index = indexPlusOne - 1;
        // 转为 0-based 数组下标
        address lastOwner = _owners[_owners.length - 1];
        // 取数组最后一个元素，用于 swap-and-pop

        if (owner != lastOwner) {
            _owners[index] = lastOwner;
            // 用最后一个 owner 填被删位置，O(1) 删除
            _ownerIndex[lastOwner] = indexPlusOne;
            // 被移动的 lastOwner 索引更新为被删位置的 1-based 下标
        }

        _owners.pop();
        // 数组长度 -1，删掉末尾重复项
        delete _ownerIndex[owner];
        // 清除被删 owner 的索引映射

        if (threshold > _owners.length) revert BelowThreshold();
        // 删除后若 threshold 大于剩余人数则非法

        uint256 txLen = _transactions.length;
        for (uint256 i = 0; i < txLen; ++i) {
            Transaction storage txn = _transactions[i];
            if (txn.executed) continue;
            // 已终结交易无需处理
            if (_confirmations[i][owner]) {
                _confirmations[i][owner] = false;
                // 移除该 owner 在此 tx 上的确认
                unchecked {
                    --txn.confirmationCount;
                }
                // 同步减少计数，避免删除 owner 后仍可执行
            }
        }

        emit OwnerRemoved(owner);
    }
}
