// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title GameItem
/// @notice 游戏道具 NFT 合约：支持按 token 存储元数据 URI，公开 mint 与 owner 发放两种铸造方式。
/// @dev 继承 ERC721URIStorage（独立 URI）、Ownable（管理员）、ReentrancyGuard（防重入）。
///      OpenZeppelin v5 已移除 Counters，用 uint256 自增即可。
contract GameItem is ERC721URIStorage, Ownable, ReentrancyGuard {
    /// @dev 下一个待分配的 tokenId，从 0 递增；等于已铸造总数
    uint256 private _nextTokenId;

    /// @notice 每个地址通过本合约铸造（含 owner 的 awardItem）可获得的 NFT 数量上限
    uint256 public constant MAX_MINT_PER_WALLET = 5;

    /// @dev 记录各地址已通过 mint / awardItem 获得的枚数，用于 per-wallet 上限校验
    mapping(address => uint256) private _mintedBy;

    /// @dev 当某地址铸造数量达到 MAX_MINT_PER_WALLET 时抛出
    error MintCapExceeded();

    /// @notice 部署合约，初始化 NFT 名称与符号，并将部署者设为 owner
    constructor() ERC721("GameItem", "ITM") Ownable(msg.sender) {}

    /// @notice 某地址已通过 mint / awardItem 获得的枚数（用于上限校验）
    /// @param account 待查询的钱包地址
    /// @return 该地址已铸造的 NFT 数量
    function mintCountOf(address account) external view returns (uint256) {
        return _mintedBy[account];
    }

    /// @notice 已铸造的 token 数量（下一枚将使用的 id 等于该值；有效 id 为 0 .. totalMinted()-1）
    /// @return 全局已 mint 的总数，即下一个 tokenId
    function totalMinted() external view returns (uint256) {
        return _nextTokenId;
    }

    /// @dev mint 与 awardItem 共用的内部铸造逻辑
    /// @param to 接收 NFT 的地址
    /// @param tokenURI 该 token 的元数据 URI（通常为 ipfs:// 或 https:// 链接）
    /// @return 新铸造 token 的 id
    function _mintWithURI(address to, string memory tokenURI) internal returns (uint256) {
        // 校验 per-wallet 上限（mint 与 awardItem 共用同一计数）
        if (_mintedBy[to] >= MAX_MINT_PER_WALLET) revert MintCapExceeded();

        uint256 id = _nextTokenId;
        ++_nextTokenId;
        ++_mintedBy[to];

        // CEI：先更新状态，再 _safeMint（接收方为合约时会回调 onERC721Received，存在重入风险）
        _safeMint(to, id);
        // 将 URI 写入 ERC721URIStorage 的 _tokenURIs 映射，并触发 MetadataUpdate 事件
        _setTokenURI(id, tokenURI);
        return id;
    }

    /// @notice 任意地址可为本人铸造 NFT（需支付 gas），每地址最多 MAX_MINT_PER_WALLET 枚（含 awardItem）
    /// @param tokenURI 元数据 URI，由调用者自行传入（合约不做格式校验）
    /// @return 新铸造 token 的 id
    function mint(string memory tokenURI) external nonReentrant returns (uint256) {
        return _mintWithURI(msg.sender, tokenURI);
    }

    /// @notice 仅 owner 可为任意地址铸造；受同一 per-wallet 上限约束
    /// @param player 接收 NFT 的玩家地址
    /// @param tokenURI 元数据 URI
    /// @return 新铸造 token 的 id
    function awardItem(address player, string memory tokenURI) public onlyOwner nonReentrant returns (uint256) {
        return _mintWithURI(player, tokenURI);
    }
}
