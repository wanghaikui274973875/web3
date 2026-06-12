// SPDX-License-Identifier: MIT
// 开源许可证 MIT
pragma solidity ^0.8.30;
// Solidity 编译器版本

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
// OpenZeppelin 数学库：提供 log2 等位运算辅助

/// @title MSBFinder
/// @notice 查找 uint256 最高有效位（MSB）的位置与掩码值。
/// @dev 位下标从 0 起算（最低位为 0）；输入为 0 时 revert。
contract MSBFinder {
    // 纯计算合约，无状态变量

    /// @dev 输入为 0 时无有效位可找
    error ZeroInput();

    /// @notice 二分法查找 MSB 下标（gas 友好，生产常用）
    /// @dev 每次将搜索区间折半：先判高 128 位是否有 1，再 64、32…直至最低位
    /// @param x 待分析的整数，须 > 0
    /// @return pos 最高有效位的下标，满足 2^pos <= x < 2^(pos+1)（x 为 2 的幂时取等）
    function msb(uint256 x) public pure returns (uint8 pos) {
        if (x == 0) revert ZeroInput();
        // 0 没有置位比特，直接回滚

        if (x >> 128 != 0) {
            x >>= 128;
            pos += 128;
        }
        // 高 128 位有 1：MSB 至少在 128 以上，右移对齐后继续
        if (x >> 64 != 0) {
            x >>= 64;
            pos += 64;
        }
        // 在当前 128 位窗口内，检查高 64 位
        if (x >> 32 != 0) {
            x >>= 32;
            pos += 32;
        }
        if (x >> 16 != 0) {
            x >>= 16;
            pos += 16;
        }
        if (x >> 8 != 0) {
            x >>= 8;
            pos += 8;
        }
        if (x >> 4 != 0) {
            x >>= 4;
            pos += 4;
        }
        if (x >> 2 != 0) {
            x >>= 2;
            pos += 2;
        }
        if (x >> 1 != 0) {
            pos += 1;
        }
        // 剩余 x 为 1 时 MSB 就在当前 pos；为 0 则 MSB 已在上一轮确定
    }

    /// @notice 线性扫描查找 MSB（直观易懂，gas 较高，适合对照学习）
    /// @dev 从第 255 位向第 0 位逐位检查，找到第一个为 1 的位即 MSB
    /// @param x 待分析的整数，须 > 0
    /// @return pos 最高有效位下标
    function msbNaive(uint256 x) public pure returns (uint8 pos) {
        if (x == 0) revert ZeroInput();
        // 与 msb 相同的零值保护

        for (uint8 i = 255; ; --i) {
            if ((x >> i) & 1 == 1) {
                return i;
            }
            // 当前位为 1 则即为最高有效位（从高往低扫）
            if (i == 0) break;
            // 防止 uint8 下溢：扫到 0 位后退出
        }
        revert ZeroInput();
        // 理论上不可达；满足编译器完整性
    }

    /// @notice 通过 OpenZeppelin Math.log2 求 MSB 下标
    /// @dev floor(log2(x)) 等价于 MSB 下标；与 msb() 结果应一致
    /// @param x 待分析的整数，须 > 0
    /// @return pos 最高有效位下标
    function msbOz(uint256 x) public pure returns (uint8 pos) {
        if (x == 0) revert ZeroInput();
        // OZ log2 对 0 会 revert，此处先统一自定义错误
        pos = uint8(Math.log2(x));
        // log2(1)=0，log2(8)=3，与 MSB 定义一致
    }

    /// @notice 返回仅保留最高有效位后的数值（MSB 掩码）
    /// @dev 例如 x=13 (0b1101) → 8 (0b1000)；内部复用 msb()
    /// @param x 待分析的整数，须 > 0
    /// @return value 等于 1 << msb(x)
    function msbValue(uint256 x) public pure returns (uint256 value) {
        uint8 pos = msb(x);
        // 先求 MSB 下标
        value = 1 << pos;
        // 仅保留最高位为 1 的数
    }
}
