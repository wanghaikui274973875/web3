// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev OpenZeppelin v5 已移除 Counters，用 uint256 自增即可。
contract GameItem is ERC721URIStorage, Ownable, ReentrancyGuard {
    uint256 private _nextTokenId;

    /// @notice 每个地址通过本合约铸造（含 owner 的 awardItem）可获得的 NFT 数量上限
    uint256 public constant MAX_MINT_PER_WALLET = 5;

    mapping(address => uint256) private _mintedBy;

    error MintCapExceeded();

    constructor() ERC721("GameItem", "ITM") Ownable(msg.sender) {}

    /// @notice 某地址已通过 mint / awardItem 获得的枚数（用于上限校验）
    function mintCountOf(address account) external view returns (uint256) {
        return _mintedBy[account];
    }

    /// @notice 已铸造的 token 数量（下一枚将使用的 id 等于该值；有效 id 为 0 .. totalMinted()-1）
    function totalMinted() external view returns (uint256) {
        return _nextTokenId;
    }

    function _mintWithURI(address to, string memory tokenURI) internal returns (uint256) {
        if (_mintedBy[to] >= MAX_MINT_PER_WALLET) revert MintCapExceeded();

        uint256 id = _nextTokenId;
        ++_nextTokenId;
        ++_mintedBy[to];

        // CEI：状态先更新，再 _safeMint（可能回调接收合约的 onERC721Received）
        _safeMint(to, id);
        _setTokenURI(id, tokenURI);
        return id;
    }

    /// @notice 任意地址可为本人铸造 NFT（需支付 gas），每地址最多 MAX_MINT_PER_WALLET 枚（含 awardItem）
    function mint(string memory tokenURI) external nonReentrant returns (uint256) {
        return _mintWithURI(msg.sender, tokenURI);
    }

    /// @notice 仅 owner 可为任意地址铸造；受同一 per-wallet 上限约束
    function awardItem(address player, string memory tokenURI) public onlyOwner nonReentrant returns (uint256) {
        return _mintWithURI(player, tokenURI);
    }
}
