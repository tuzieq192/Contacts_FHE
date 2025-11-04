pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ContactsFHE is ZamaEthereumConfig {
    
    struct Contact {
        string name;
        euint32 encryptedContactInfo;
        string publicKey;
        uint256 creationTimestamp;
        bool isVerified;
        uint32 decryptedContactInfo;
    }
    
    mapping(string => Contact) private contacts;
    string[] private contactIds;
    
    event ContactAdded(string indexed contactId, address indexed creator);
    event ContactVerified(string indexed contactId, uint32 decryptedValue);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function addContact(
        string calldata contactId,
        string calldata name,
        externalEuint32 encryptedContactInfo,
        bytes calldata inputProof,
        string calldata publicKey
    ) external {
        require(bytes(contacts[contactId].name).length == 0, "Contact already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedContactInfo, inputProof)), "Invalid encrypted input");
        
        contacts[contactId] = Contact({
            name: name,
            encryptedContactInfo: FHE.fromExternal(encryptedContactInfo, inputProof),
            publicKey: publicKey,
            creationTimestamp: block.timestamp,
            isVerified: false,
            decryptedContactInfo: 0
        });
        
        FHE.allowThis(contacts[contactId].encryptedContactInfo);
        FHE.makePubliclyDecryptable(contacts[contactId].encryptedContactInfo);
        
        contactIds.push(contactId);
        emit ContactAdded(contactId, msg.sender);
    }
    
    function verifyContact(
        string calldata contactId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(contacts[contactId].name).length > 0, "Contact does not exist");
        require(!contacts[contactId].isVerified, "Contact already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(contacts[contactId].encryptedContactInfo);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        contacts[contactId].decryptedContactInfo = decodedValue;
        contacts[contactId].isVerified = true;
        
        emit ContactVerified(contactId, decodedValue);
    }
    
    function getEncryptedContactInfo(string calldata contactId) external view returns (euint32) {
        require(bytes(contacts[contactId].name).length > 0, "Contact does not exist");
        return contacts[contactId].encryptedContactInfo;
    }
    
    function getContact(string calldata contactId) external view returns (
        string memory name,
        string memory publicKey,
        uint256 creationTimestamp,
        bool isVerified,
        uint32 decryptedContactInfo
    ) {
        require(bytes(contacts[contactId].name).length > 0, "Contact does not exist");
        Contact storage contact = contacts[contactId];
        
        return (
            contact.name,
            contact.publicKey,
            contact.creationTimestamp,
            contact.isVerified,
            contact.decryptedContactInfo
        );
    }
    
    function getAllContactIds() external view returns (string[] memory) {
        return contactIds;
    }
    
    function contactExists(string calldata contactId) external view returns (bool) {
        return bytes(contacts[contactId].name).length > 0;
    }
}


