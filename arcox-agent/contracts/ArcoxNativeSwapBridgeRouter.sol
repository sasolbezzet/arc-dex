// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Like {
    function balanceOf(address owner) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
}

interface IUniversalRouterLike {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface ITokenMessengerV2Like {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;
}

contract ArcoxNativeSwapBridgeRouter {
    address public owner;
    address public treasury;
    uint16 public feeBps;

    address public immutable wrappedNative;
    address public immutable usdc;
    address public immutable swapRouter;
    address public immutable tokenMessenger;
    uint32 public immutable localDomain;

    mapping(uint32 => bool) public supportedDestinationDomains;
    mapping(uint24 => bool) public supportedPoolFees;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TreasuryUpdated(address indexed treasury);
    event FeeUpdated(uint16 feeBps);
    event DestinationDomainUpdated(uint32 indexed domain, bool supported);
    event PoolFeeUpdated(uint24 indexed poolFee, bool supported);
    event NativeSwapBridge(
        address indexed payer,
        uint32 indexed destinationDomain,
        bytes32 mintRecipient,
        uint256 nativeAmountIn,
        uint256 usdcOut,
        uint256 platformFee,
        uint24 poolFee
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    constructor(
        address initialOwner,
        address initialTreasury,
        address wrappedNative_,
        address usdc_,
        address swapRouter_,
        address tokenMessenger_,
        uint32 localDomain_,
        uint16 feeBps_
    ) {
        require(initialOwner != address(0), "BAD_OWNER");
        require(initialTreasury != address(0), "BAD_TREASURY");
        require(wrappedNative_ != address(0), "BAD_WRAPPED_NATIVE");
        require(usdc_ != address(0), "BAD_USDC");
        require(swapRouter_ != address(0), "BAD_SWAP_ROUTER");
        require(tokenMessenger_ != address(0), "BAD_MESSENGER");
        require(feeBps_ <= 1_000, "FEE_TOO_HIGH");
        owner = initialOwner;
        treasury = initialTreasury;
        wrappedNative = wrappedNative_;
        usdc = usdc_;
        swapRouter = swapRouter_;
        tokenMessenger = tokenMessenger_;
        localDomain = localDomain_;
        feeBps = feeBps_;
        supportedPoolFees[500] = true;
        supportedPoolFees[3000] = true;
        supportedPoolFees[10000] = true;
        emit OwnershipTransferred(address(0), initialOwner);
        emit TreasuryUpdated(initialTreasury);
        emit FeeUpdated(feeBps_);
        emit PoolFeeUpdated(500, true);
        emit PoolFeeUpdated(3000, true);
        emit PoolFeeUpdated(10000, true);
    }

    receive() external payable {}

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "BAD_OWNER");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setTreasury(address nextTreasury) external onlyOwner {
        require(nextTreasury != address(0), "BAD_TREASURY");
        treasury = nextTreasury;
        emit TreasuryUpdated(nextTreasury);
    }

    function setFeeBps(uint16 nextFeeBps) external onlyOwner {
        require(nextFeeBps <= 1_000, "FEE_TOO_HIGH");
        feeBps = nextFeeBps;
        emit FeeUpdated(nextFeeBps);
    }

    function setSupportedDestinationDomain(uint32 domain, bool supported) external onlyOwner {
        supportedDestinationDomains[domain] = supported;
        emit DestinationDomainUpdated(domain, supported);
    }

    function setSupportedPoolFee(uint24 poolFee, bool supported) external onlyOwner {
        supportedPoolFees[poolFee] = supported;
        emit PoolFeeUpdated(poolFee, supported);
    }

    function quoteFee(uint256 amount) public view returns (uint256 fee, uint256 netAmount) {
        fee = (amount * feeBps) / 10_000;
        netAmount = amount - fee;
    }

    function swapNativeAndBridgeUsdc(
        uint32 destinationDomain,
        bytes32 mintRecipient,
        bytes32 destinationCaller,
        uint24 poolFee,
        uint256 amountOutMinimum,
        uint256 deadline,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external payable returns (uint256 usdcOut, uint256 platformFee, uint256 netUsdc) {
        require(msg.value > 0, "NO_NATIVE");
        require(supportedDestinationDomains[destinationDomain], "DOMAIN_NOT_SUPPORTED");
        require(destinationDomain != localDomain, "SAME_DOMAIN");
        require(mintRecipient != bytes32(0), "BAD_RECIPIENT");
        require(supportedPoolFees[poolFee], "POOL_FEE_NOT_SUPPORTED");
        require(deadline >= block.timestamp, "DEADLINE_EXPIRED");

        uint256 beforeUsdc = IERC20Like(usdc).balanceOf(address(this));
        bytes memory commands = new bytes(2);
        commands[0] = 0x0b; // WRAP_ETH
        commands[1] = 0x00; // V3_SWAP_EXACT_IN
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(swapRouter, msg.value);
        inputs[1] = abi.encode(
            address(this),
            msg.value,
            amountOutMinimum,
            abi.encodePacked(wrappedNative, poolFee, usdc),
            false,
            new uint256[](0)
        );
        IUniversalRouterLike(swapRouter).execute{value: msg.value}(commands, inputs, deadline);
        uint256 actualOut = IERC20Like(usdc).balanceOf(address(this)) - beforeUsdc;
        require(actualOut >= amountOutMinimum, "SLIPPAGE");
        usdcOut = actualOut;

        (platformFee, netUsdc) = quoteFee(usdcOut);
        require(netUsdc > 0, "NET_ZERO");
        if (platformFee > 0) _push(usdc, treasury, platformFee);

        _forceApprove(usdc, tokenMessenger, 0);
        _forceApprove(usdc, tokenMessenger, netUsdc);
        ITokenMessengerV2Like(tokenMessenger).depositForBurn(
            netUsdc,
            destinationDomain,
            mintRecipient,
            usdc,
            destinationCaller,
            maxFee,
            minFinalityThreshold
        );
        emit NativeSwapBridge(msg.sender, destinationDomain, mintRecipient, msg.value, usdcOut, platformFee, poolFee);
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "BAD_TO");
        _push(token, to, amount);
    }

    function rescueNative(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "BAD_TO");
        (bool ok,) = to.call{value: amount}("");
        require(ok, "NATIVE_TRANSFER_FAILED");
    }

    function _push(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20Like.transfer.selector, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FAILED");
    }

    function _forceApprove(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20Like.approve.selector, spender, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "APPROVE_FAILED");
    }
}
