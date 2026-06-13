// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract BJTToken is ERC20 {
    constructor(uint256 supply) ERC20("BountyJudge Token", "BJT") {
        _mint(msg.sender, supply);
    }
}
