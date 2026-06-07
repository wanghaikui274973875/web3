// SPDX-License-Identifier: MIT
// 开源许可证 MIT
pragma solidity ^0.8.30;
// Solidity 编译器版本

import "../auction/EnglishAuctionHouse.sol";
// 引入被测拍卖合约

/// @title RejectEthBidder
/// @dev 测试辅助：可代出价但 receive 拒收 ETH，验证 Pull 退款不阻塞竞价
contract RejectEthBidder {
    /// @notice 拒收任意转入的 ETH
    receive() external payable {
        // 收到 ETH 时
        revert();
        // 故意 revert，模拟拒收退款的合约
    }

    /// @notice 以本合约身份向 House 出价
    /// @param house EnglishAuctionHouse 地址
    /// @param roundId 轮次 id
    /// @param amount 出价金额（须等于 msg.value）
    function placeBid(address house, uint256 roundId, uint256 amount) external payable {
        // 外部入口：代合约出价
        EnglishAuctionHouse(payable(house)).bid{value: msg.value}(roundId, amount);
        // 转发 msg.value 调用 House.bid
    }
}
