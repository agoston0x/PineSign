// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * PineSign resolver.
 *
 * Set as the resolver of the server's name. Through ENSIP-10 wildcard
 * resolution it then answers for every subname beneath it — so
 * `<id>.tx.pinesign.eth` resolves, and carries text records, without a token
 * ever being minted for it.
 *
 * Records are written by the operator (the server) and are the transfer's
 * attestation: who sent, who received, the hash of what, where it was stored,
 * and both signatures. Once a transfer is marked delivered its records are
 * frozen — the point of a receipt is that nobody can amend it afterwards,
 * including the party who wrote it.
 */
contract PineSignResolver {
    address public immutable operator;

    mapping(bytes32 => mapping(string => string)) private texts;
    mapping(bytes32 => bool) public frozen;

    event TextChanged(bytes32 indexed node, string indexed indexedKey, string key, string value);
    event Frozen(bytes32 indexed node);

    error NotOperator();
    error NodeFrozen();

    constructor(address operator_) {
        operator = operator_;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    // ---- writes ----

    function setText(bytes32 node, string calldata key, string calldata value) external onlyOperator {
        if (frozen[node]) revert NodeFrozen();
        texts[node][key] = value;
        emit TextChanged(node, key, key, value);
    }

    /// Write several records in one transaction, so an attestation lands whole
    /// rather than half-written if something interrupts it.
    function setTexts(bytes32 node, string[] calldata keys, string[] calldata values) external onlyOperator {
        if (frozen[node]) revert NodeFrozen();
        require(keys.length == values.length, "length mismatch");
        for (uint256 i = 0; i < keys.length; i++) {
            texts[node][keys[i]] = values[i];
            emit TextChanged(node, keys[i], keys[i], values[i]);
        }
    }

    /// Write several records and freeze in one transaction — a receipt lands whole.
    function finalize(bytes32 node, string[] calldata keys, string[] calldata values) external onlyOperator {
        if (frozen[node]) revert NodeFrozen();
        require(keys.length == values.length, "length mismatch");
        for (uint256 i = 0; i < keys.length; i++) {
            texts[node][keys[i]] = values[i];
            emit TextChanged(node, keys[i], keys[i], values[i]);
        }
        frozen[node] = true;
        emit Frozen(node);
    }

    // ---- reads: ENSIP-5 text records ----

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return texts[node][key];
    }

    // ---- ENSIP-10: wildcard resolution ----

    /// Any subname of the name this resolver is set on resolves here. The
    /// encoded name is decoded to its namehash and the inner call dispatched.
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory) {
        bytes32 node = namehash(name, 0);
        bytes4 selector = bytes4(data[:4]);

        if (selector == this.text.selector) {
            (, string memory key) = abi.decode(data[4:], (bytes32, string));
            return abi.encode(texts[node][key]);
        }
        revert("unsupported");
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 // ERC-165
            || id == 0x59d1d43c // text(bytes32,string)
            || id == 0x9061b923; // resolve(bytes,bytes), ENSIP-10
    }

    // ---- helpers ----

    /// Namehash of a DNS-encoded name, computed from the right as ENS defines it.
    function namehash(bytes calldata name, uint256 offset) public pure returns (bytes32) {
        uint256 len = uint8(name[offset]);
        if (len == 0) return bytes32(0);
        bytes32 rest = namehash(name, offset + 1 + len);
        bytes32 label = keccak256(name[offset + 1:offset + 1 + len]);
        return keccak256(abi.encodePacked(rest, label));
    }
}
