// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * PineSign receipts.
 *
 * Write-once. No owner, no upgrade path, no admin key — the only thing this
 * contract can do is record that a transfer happened, once, and then refuse to
 * ever say otherwise.
 *
 * Both halves of the proof authenticate themselves by being the caller: Alice
 * calls `send`, Bob calls `claim`. No signature verification is needed on
 * chain, because `msg.sender` already is the signature.
 *
 * Proof of decryption
 * -------------------
 * The naive design stores the plaintext hash at send time and has Bob sign it.
 * That proves nothing — the hash is public, so Bob can sign it without ever
 * opening the file. So `send` stores only a *commitment*, keccak256 of the
 * plaintext hash, and `claim` requires Bob to supply the plaintext hash whose
 * commitment it matches. He cannot produce that preimage without decrypting.
 */
contract PineSignReceipts {
    struct Transfer {
        address sender;
        address recipient;
        bytes32 commitment;    // keccak256(plaintextHash)
        bytes32 swarmRef;      // where the ciphertext lived
        bytes32 plaintextHash; // revealed by the recipient on claim
        uint64 sentAt;
        uint64 claimedAt;
    }

    mapping(bytes32 => Transfer) public transfers;

    event Sent(bytes32 indexed id, address indexed sender, address indexed recipient, bytes32 swarmRef);
    event Claimed(bytes32 indexed id, address indexed recipient, bytes32 plaintextHash);

    error AlreadySent();
    error AlreadyClaimed();
    error NotRecipient();
    error UnknownTransfer();
    error BadPreimage();

    /// The id is derived from the transfer, not chosen — so nobody can squat one
    /// they cannot construct, and no field can be swapped afterwards.
    function transferId(address sender, address recipient, bytes32 commitment)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(sender, recipient, commitment));
    }

    function send(address recipient, bytes32 commitment, bytes32 swarmRef)
        external
        returns (bytes32 id)
    {
        id = transferId(msg.sender, recipient, commitment);
        if (transfers[id].sentAt != 0) revert AlreadySent();

        transfers[id] = Transfer({
            sender: msg.sender,
            recipient: recipient,
            commitment: commitment,
            swarmRef: swarmRef,
            plaintextHash: bytes32(0),
            sentAt: uint64(block.timestamp),
            claimedAt: 0
        });

        emit Sent(id, msg.sender, recipient, swarmRef);
    }

    function claim(bytes32 id, bytes32 plaintextHash) external {
        Transfer storage t = transfers[id];
        if (t.sentAt == 0) revert UnknownTransfer();
        if (t.claimedAt != 0) revert AlreadyClaimed();
        if (msg.sender != t.recipient) revert NotRecipient();
        if (keccak256(abi.encode(plaintextHash)) != t.commitment) revert BadPreimage();

        t.plaintextHash = plaintextHash;
        t.claimedAt = uint64(block.timestamp);

        emit Claimed(id, msg.sender, plaintextHash);
    }

    function isDelivered(bytes32 id) external view returns (bool) {
        return transfers[id].claimedAt != 0;
    }
}
