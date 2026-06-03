// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SimpleStorage} from "../SimpleStorage.sol";

/**
 * @title SimpleStorageFactory
 * @dev 教学示例：由合约使用 `new` 部署其它合约，并记录已部署实例地址。
 */
contract SimpleStorageFactory {
    address[] private _instances;

    event SimpleStorageCreated(address indexed creator, address indexed instance, uint256 index);

    function create() external returns (address instance) {
        instance = address(new SimpleStorage());
        _instances.push(instance);
        emit SimpleStorageCreated(msg.sender, instance, _instances.length - 1);
    }

    function instanceCount() external view returns (uint256) {
        return _instances.length;
    }

    function getInstance(uint256 index) external view returns (address) {
        return _instances[index];
    }
}
