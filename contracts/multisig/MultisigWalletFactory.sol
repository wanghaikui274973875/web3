// SPDX-License-Identifier: MIT
// 开源许可证标识：MIT

pragma solidity ^0.8.30;
// 指定 Solidity 编译器最低版本为 0.8.30

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
// 引入 EIP-1167 最小代理库，支持 CREATE2 确定性克隆

import {MultisigWallet} from "./MultisigWallet.sol";
// 引入多签实现合约，工厂仅部署一次，后续 clone 指向该实现

/// @title MultisigWalletFactory
/// @notice 通过 CREATE2 + EIP-1167 部署确定性地址的多签钱包克隆。
/// @dev salt 相同则地址相同，可在部署前向预测地址转入 ETH（counterfactual deposit）。
contract MultisigWalletFactory {
    /// @dev 全局单例实现合约地址，所有 clone 通过 delegatecall 复用其逻辑
    MultisigWallet public immutable implementation;

    /// @dev salt → 已部署钱包地址；0 表示尚未部署
    mapping(bytes32 => address) public walletOf;

    /// @dev 工厂已部署的钱包总数（含不同 salt）
    uint256 public walletCount;

    error WalletAlreadyExists();
    // 同一 salt 重复 createWallet 时触发

    error WalletNotDeployed();
    // 查询尚未部署的 salt 对应钱包时触发

    event WalletCreated(
        address indexed creator,
        address indexed wallet,
        bytes32 indexed salt,
        address[] owners,
        uint256 threshold
    );
    // 新钱包 clone + initialize 完成

    constructor() {
        // 工厂构造时部署一次实现合约，后续 clone 共享逻辑以省 gas
        implementation = new MultisigWallet();
    }

    /// @notice 由 owners 与 threshold 推导推荐 salt（同配置同链上地址可预测）
    /// @param owners owner 地址列表
    /// @param threshold 确认阈值
    /// @return salt keccak256(abi.encode(owners, threshold))
    function computeSalt(address[] calldata owners, uint256 threshold) public pure returns (bytes32 salt) {
        salt = keccak256(abi.encode(owners, threshold));
    }

    /// @notice 预测 CREATE2 克隆钱包地址（部署前可用于 counterfactual 收款）
    /// @param salt CREATE2 salt
    /// @return predicted 若由本工厂部署，将得到的 clone 地址
    function predictAddress(bytes32 salt) public view returns (address predicted) {
        predicted = Clones.predictDeterministicAddress(address(implementation), salt, address(this));
    }

    /// @notice 按 salt 查询已部署钱包；未部署则 revert
    /// @param salt CREATE2 salt
    function getWallet(bytes32 salt) external view returns (address wallet) {
        wallet = walletOf[salt];
        if (wallet == address(0)) revert WalletNotDeployed();
    }

    /// @notice CREATE2 部署多签 clone 并 initialize
    /// @param owners 初始 owner 列表
    /// @param threshold 确认阈值
    /// @param salt CREATE2 salt；推荐 computeSalt(owners, threshold)
    /// @return wallet 新部署的 clone 地址
    function createWallet(address[] calldata owners, uint256 threshold, bytes32 salt)
        external
        returns (address wallet)
    {
        if (walletOf[salt] != address(0)) revert WalletAlreadyExists();
        // 同一 salt 不可重复部署到同一地址

        wallet = Clones.cloneDeterministic(address(implementation), salt);
        // CREATE2 部署 EIP-1167 最小代理，地址由 factory + salt + implementation 决定
        MultisigWallet(payable(wallet)).initialize(owners, threshold);
        // 在 clone 上一次性初始化 owners 与 threshold

        walletOf[salt] = wallet;
        unchecked {
            ++walletCount;
        }

        emit WalletCreated(msg.sender, wallet, salt, owners, threshold);
    }
}
