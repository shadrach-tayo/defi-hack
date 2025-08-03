// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import {IPostInteraction} from "@lop/interfaces/IPostInteraction.sol";
import {AddressLib, Address} from "@1inch/solidity-utils/contracts/libraries/AddressLib.sol";
import {MakerTraitsLib, MakerTraits} from "@lop/libraries/MakerTraitsLib.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {UniERC20} from "@1inch/solidity-utils/contracts/libraries/UniERC20.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAmountGetter} from "@lop/interfaces/IAmountGetter.sol";
import {IOrderMixin} from "@lop/interfaces/IOrderMixin.sol";
import {OrderLib} from "@lop/OrderLib.sol";

/// @title TWAP (Time-Weighted Average Price) predicate contract for scheduled execution windows with fill count tracking
contract TWAP is IPostInteraction, IAmountGetter, Ownable {
    using SafeERC20 for IERC20;
    using UniERC20 for IERC20;
    using AddressLib for Address;
    using MakerTraitsLib for MakerTraits;
    using OrderLib for IOrderMixin.Order;

    error InvalidExecutionWindow();
    error InvalidMaxFills();
    error OrderAlreadyClosed();
    error UnauthorizedCaller();
    error OrderAlreadySetup();
    error OrderAlreadyCancelled();
    error EthTransferFailed();

    address private _LOP;
    address private _WETH;
    uint256 internal constant _FEE_BASE = 1e6;

    /// @notice Storage slot for tracking fill counts per order
    /// @dev Uses order hash as key to track fills
    mapping(bytes32 => uint256) private _fillCounts;

    /// @notice Storage slot for execution windows per order
    /// @dev Uses order hash as key to store window data
    mapping(bytes32 => ExecutionWindow) private _executionWindows;

    /// @notice Mapping to track which orders have been setup for TWAP execution
    mapping(bytes32 => bool) private _twapOrders;

    /// @notice Mapping to store orderKey for each orderHash (for reverse lookup)
    mapping(bytes32 => bytes32) private _orderKeyToOrderHash;

    event OrderCreated(
        bytes32 indexed orderHash,
        bytes32 indexed orderKey,
        uint256 startTime,
        uint256 endTime,
        uint256 maxFills,
        uint256 interval
    );
    event OrderCancelled(bytes32 indexed orderHash);

    struct ExecutionWindow {
        uint256 startTime;
        uint256 endTime;
        uint256 maxFills;
        uint256 interval;
    }

    modifier onlyLimitOrderProtocol() {
        if (msg.sender != _LOP) revert UnauthorizedCaller();
        _;
    }

    constructor(address _lop, address _weth) Ownable(msg.sender) {
        _LOP = _lop;
        _WETH = _weth;
    }

    receive() external payable {}

    /// @notice Sets up an execution window for an order
    /// @param orderHash The hash of the order to set up execution window for
    /// @param startTime The start time of the execution window
    /// @param endTime The end time of the execution window
    /// @param maxFills The maximum number of fills allowed for this order
    /// @param interval The time interval between fills (in seconds)
    function setupExecutionWindow(
        bytes32 orderHash,
        bytes32 orderKey,
        uint256 startTime,
        uint256 endTime,
        uint256 maxFills,
        uint256 interval
    ) external {
        if (startTime >= endTime) revert InvalidExecutionWindow();
        if (maxFills == 0) revert InvalidMaxFills();
        if (interval == 0) revert InvalidExecutionWindow();

        if (_twapOrders[orderHash]) revert OrderAlreadySetup();

        _executionWindows[orderHash] =
            ExecutionWindow({startTime: startTime, endTime: endTime, maxFills: maxFills, interval: interval});

        _twapOrders[orderHash] = true;
        _orderKeyToOrderHash[orderKey] = orderHash;

        emit OrderCreated(orderHash, orderKey, startTime, endTime, maxFills, interval);
    }

    function cancelExecutionWindow(bytes32 orderHash) external returns (bool) {
        if (!_twapOrders[orderHash]) revert OrderAlreadyCancelled();
        _executionWindows[orderHash] = ExecutionWindow({startTime: 0, endTime: 0, maxFills: 0, interval: 0});
        _twapOrders[orderHash] = false;
        // _orderKeyToOrderHash[orderKey] = bytes32(0);

        emit OrderCancelled(orderHash);

        return true;
    }

    function setLOP(address _lop) external onlyOwner {
        _LOP = _lop;
    }

    /// @notice Checks if the current time is within the execution window and fill count hasn't been exceeded
    /// @param orderKey The key of the order to check
    /// @return True if the order can be filled, false otherwise
    function canExecute(bytes32 orderKey) external view onlyLimitOrderProtocol returns (uint256) {
        bytes32 orderHash = _orderKeyToOrderHash[orderKey];

        if (!_twapOrders[orderHash]) return 0;

        ExecutionWindow memory window = _executionWindows[orderHash];

        // Check if current time is within the execution window
        if (block.timestamp < window.startTime || block.timestamp >= window.endTime) {
            return 0;
        }

        // Check if fill count hasn't been exceeded
        if (_fillCounts[orderHash] >= window.maxFills) {
            return 0;
        }

        // Check if enough time has passed since the last fill (TWAP logic)
        uint256 nextIntervalStart = window.startTime + (window.interval * _fillCounts[orderHash]);
        uint256 nextIntervalEnd = nextIntervalStart + window.interval;

        if (block.timestamp < nextIntervalStart || block.timestamp >= nextIntervalEnd) {
            return 0;
        }

        return 1;
    }

    /// @notice Records a fill for an order (called automatically by post-interaction)
    /// @param order The order that was filled
    /// @param extension The order extension (unused in this implementation)
    /// @param orderHash The hash of the order that was filled
    /// @param taker The address that filled the order
    /// @param makingAmount The amount of maker asset that was traded
    /// @param takingAmount The amount of taker asset that was traded
    /// @param remainingMakingAmount The remaining amount of maker asset
    /// @param extraData Additional data (unused in this implementation)
    function postInteraction(
        IOrderMixin.Order calldata order,
        bytes calldata extension,
        bytes32 orderHash,
        address taker,
        uint256 makingAmount,
        uint256 takingAmount,
        uint256 remainingMakingAmount,
        bytes calldata extraData
    ) external onlyLimitOrderProtocol {
        // Only record fills for TWAP orders
        if (!_twapOrders[orderHash]) return;

        ExecutionWindow memory window = _executionWindows[orderHash];
        if (_fillCounts[orderHash] >= window.maxFills) revert OrderAlreadyClosed();

        _fillCounts[orderHash]++;

        // take fees from
        if (extraData.length > 0) {
            _takeFees(order, takingAmount, extraData);
        }
    }

    /// @notice Records a fill for an order (manual call for testing or external integration)
    /// @param orderHash The hash of the order that was filled
    function recordFill(bytes32 orderHash) external {
        if (!_twapOrders[orderHash]) revert InvalidExecutionWindow();

        ExecutionWindow memory window = _executionWindows[orderHash];
        if (_fillCounts[orderHash] >= window.maxFills) revert OrderAlreadyClosed();

        _fillCounts[orderHash]++;
    }

    /// @notice Gets the current fill count for an order
    /// @param orderHash The hash of the order
    /// @return The current number of fills for this order
    function getFillCount(bytes32 orderHash) external view returns (uint256) {
        return _fillCounts[orderHash];
    }

    /// @notice Gets the execution window data for an order
    /// @param orderHash The hash of the order
    /// @return startTime The start time of the execution window
    /// @return endTime The end time of the execution window
    /// @return maxFills The maximum number of fills allowed
    /// @return interval The time interval between fills
    function getExecutionWindow(bytes32 orderHash)
        external
        view
        returns (uint256 startTime, uint256 endTime, uint256 maxFills, uint256 interval)
    {
        ExecutionWindow memory window = _executionWindows[orderHash];
        return (window.startTime, window.endTime, window.maxFills, window.interval);
    }

    /// @notice Checks if an order is within its execution window (time-based check only)
    /// @param orderHash The hash of the order to check
    /// @return True if within time window, false otherwise
    function isWithinTimeWindow(bytes32 orderHash) external view returns (bool) {
        if (!_twapOrders[orderHash]) return false;

        ExecutionWindow memory window = _executionWindows[orderHash];
        return block.timestamp >= window.startTime && block.timestamp < window.endTime;
    }

    /// @notice Checks if an order has reached its maximum fill count
    /// @param orderHash The hash of the order to check
    /// @return True if max fills reached, false otherwise
    function hasReachedMaxFills(bytes32 orderHash) external view returns (bool) {
        if (!_twapOrders[orderHash]) return false;

        ExecutionWindow memory window = _executionWindows[orderHash];
        return _fillCounts[orderHash] >= window.maxFills;
    }

    /// @notice Checks if an order is a TWAP order
    /// @param orderHash The hash of the order to check
    /// @return True if it's a TWAP order, false otherwise
    function isTWAPOrder(bytes32 orderHash) external view returns (bool) {
        return _twapOrders[orderHash];
    }

    /// @notice Gets the remaining fills for an order
    /// @param orderHash The hash of the order
    /// @return The number of fills remaining
    function getRemainingFills(bytes32 orderHash) external view returns (uint256) {
        if (!_twapOrders[orderHash]) return 0;

        ExecutionWindow memory window = _executionWindows[orderHash];
        uint256 currentFills = _fillCounts[orderHash];

        if (currentFills >= window.maxFills) return 0;
        return window.maxFills - currentFills;
    }

    /// @notice Gets the time remaining in the execution window
    /// @param orderHash The hash of the order
    /// @return The time remaining in seconds, or 0 if window has ended
    function getTimeRemaining(bytes32 orderHash) external view returns (uint256) {
        if (!_twapOrders[orderHash]) return 0;

        ExecutionWindow memory window = _executionWindows[orderHash];

        if (block.timestamp >= window.endTime) return 0;
        if (block.timestamp < window.startTime) return window.endTime - window.startTime;

        return window.endTime - block.timestamp;
    }

    /// @notice Gets the next fill time for an order (TWAP specific)
    /// @param orderHash The hash of the order
    /// @return The timestamp when the next fill is allowed
    function getNextFillTime(bytes32 orderHash) external view returns (uint256) {
        if (!_twapOrders[orderHash]) return 0;

        ExecutionWindow memory window = _executionWindows[orderHash];
        uint256 currentFills = _fillCounts[orderHash];

        if (currentFills >= window.maxFills) return 0;

        return window.startTime + (window.interval * currentFills);
    }

    /// @notice Checks if enough time has passed for the next fill (TWAP specific)
    /// @param orderHash The hash of the order
    /// @return True if enough time has passed for the next fill
    function canFillNow(bytes32 orderHash) external view returns (bool) {
        if (!_twapOrders[orderHash]) return false;

        ExecutionWindow memory window = _executionWindows[orderHash];

        // Check if within time window
        if (block.timestamp < window.startTime || block.timestamp >= window.endTime) {
            return false;
        }

        // Check if max fills reached
        if (_fillCounts[orderHash] >= window.maxFills) {
            return false;
        }

        // Check if enough time has passed for the next fill
        uint256 nextIntervalStart = window.startTime + (window.interval * _fillCounts[orderHash]);
        uint256 nextIntervalEnd = nextIntervalStart + window.interval;
        return block.timestamp >= nextIntervalStart && block.timestamp < nextIntervalEnd;
    }

    function lop() external view returns (address) {
        return _LOP;
    }

    function rescueFunds(IERC20 token, address to) external onlyOwner {
        token.uniTransfer(payable(to), IERC20(token).balanceOf(address(this)));
    }

    function _takeFees(IOrderMixin.Order calldata order, uint256 takingAmount, bytes calldata extraData) internal {
        uint256 fee = takingAmount * uint256(uint16(bytes2(extraData))) / _FEE_BASE;
        address feeRecipient = address(bytes20(extraData[2:22]));

        address receiver = order.maker.get();
        if (extraData.length > 22) {
            receiver = address(bytes20(extraData[22:42]));
        }

        bool isEth = order.takerAsset.get() == address(_WETH) && order.makerTraits.unwrapWeth();

        if (isEth) {
            if (fee > 0) {
                _sendEth(feeRecipient, fee);
            }

            unchecked {
                _sendEth(receiver, takingAmount - fee);
            }
        } else {
            if (fee > 0) {
                IERC20(order.takerAsset.get()).safeTransfer(feeRecipient, fee);
            }

            unchecked {
                IERC20(order.takerAsset.get()).safeTransfer(receiver, takingAmount - fee);
            }
        }
    }

    function _sendEth(address to, uint256 amount) private {
        (bool success,) = to.call{value: amount}("");
        if (!success) revert EthTransferFailed();
    }
}
