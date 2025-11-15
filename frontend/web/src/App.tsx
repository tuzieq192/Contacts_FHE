import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface ContactData {
  id: string;
  name: string;
  phoneNumber: string;
  email: string;
  description: string;
  publicValue1: number;
  publicValue2: number;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface OperationHistory {
  id: string;
  type: 'create' | 'verify' | 'decrypt';
  contactName: string;
  timestamp: number;
  status: 'success' | 'error';
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<ContactData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingContact, setCreatingContact] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newContactData, setNewContactData] = useState({ 
    name: "", 
    phoneNumber: "", 
    email: "", 
    description: "",
    priority: 1 
  });
  const [selectedContact, setSelectedContact] = useState<ContactData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ phoneNumber: number | null }>({ phoneNumber: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [operationHistory, setOperationHistory] = useState<OperationHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const contactsList: ContactData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          contactsList.push({
            id: businessId,
            name: businessData.name,
            phoneNumber: businessId,
            email: `user${businessData.publicValue1}@encrypted.com`,
            description: businessData.description,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading contact data:', e);
        }
      }
      
      setContacts(contactsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load contacts" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const addOperationToHistory = (type: OperationHistory['type'], contactName: string, status: 'success' | 'error') => {
    const newOperation: OperationHistory = {
      id: Date.now().toString(),
      type,
      contactName,
      timestamp: Date.now(),
      status
    };
    setOperationHistory(prev => [newOperation, ...prev.slice(0, 9)]);
  };

  const testContractAvailability = async () => {
    if (!isConnected) {
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return;
    }
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE Contract is available and ready!" });
        addOperationToHistory('verify', 'System Check', 'success');
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract check failed" });
    } finally {
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    }
  };

  const createContact = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingContact(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting contact with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const phoneNumberValue = parseInt(newContactData.phoneNumber.replace(/\D/g, '')) || 0;
      const businessId = `contact-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, phoneNumberValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newContactData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        newContactData.priority,
        0,
        `Email: ${newContactData.email} | ${newContactData.description}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Storing encrypted contact on-chain..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Contact encrypted and stored!" });
      addOperationToHistory('create', newContactData.name, 'success');
      
      await loadData();
      setShowCreateModal(false);
      setNewContactData({ name: "", phoneNumber: "", email: "", description: "", priority: 1 });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      addOperationToHistory('create', newContactData.name, 'error');
    } finally { 
      setCreatingContact(false); 
    }
  };

  const decryptContact = async (contactId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const contactData = await contractRead.getBusinessData(contactId);
      if (contactData.isVerified) {
        const storedValue = Number(contactData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Phone number already verified" });
        addOperationToHistory('verify', contactData.name, 'success');
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(contactId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(contactId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      setTransactionStatus({ visible: true, status: "success", message: "Phone number decrypted and verified!" });
      addOperationToHistory('decrypt', contactData.name, 'success');
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Phone number already verified" });
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      addOperationToHistory('decrypt', selectedContact?.name || 'Unknown', 'error');
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const filteredContacts = contacts.filter(contact =>
    contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    totalContacts: contacts.length,
    verifiedContacts: contacts.filter(c => c.isVerified).length,
    highPriority: contacts.filter(c => c.publicValue1 >= 8).length,
    recentContacts: contacts.filter(c => Date.now()/1000 - c.timestamp < 60 * 60 * 24 * 7).length
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header metal-header">
          <div className="logo">
            <div className="logo-icon">🔐</div>
            <h1>Private Address Book</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt metal-prompt">
          <div className="connection-content">
            <div className="connection-icon">🛡️</div>
            <h2>Secure Your Contacts with FHE</h2>
            <p>Connect your wallet to start using fully homomorphic encryption for your address book</p>
            <div className="connection-steps">
              <div className="step">
                <span className="step-number">1</span>
                <p>Connect wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span className="step-number">2</span>
                <p>Add contacts with encrypted phone numbers</p>
              </div>
              <div className="step">
                <span className="step-number">3</span>
                <p>Access your data securely anytime</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen metal-loading">
        <div className="fhe-spinner metal-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your contacts with military-grade encryption</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen metal-loading">
      <div className="fhe-spinner metal-spinner"></div>
      <p>Loading encrypted address book...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header metal-header">
        <div className="logo">
          <div className="logo-icon">🔐</div>
          <h1>Private Address Book</h1>
        </div>
        
        <div className="header-actions">
          <button 
            className="history-btn metal-btn"
            onClick={() => setShowHistory(!showHistory)}
          >
            📊 History
          </button>
          <button 
            onClick={testContractAvailability}
            className="test-btn metal-btn"
          >
            Test FHE
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn metal-btn primary"
          >
            + New Contact
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container metal-content">
        <div className="stats-section metal-section">
          <div className="stats-grid">
            <div className="stat-card metal-card">
              <div className="stat-icon">👥</div>
              <div className="stat-content">
                <div className="stat-value">{stats.totalContacts}</div>
                <div className="stat-label">Total Contacts</div>
              </div>
            </div>
            <div className="stat-card metal-card">
              <div className="stat-icon">✅</div>
              <div className="stat-content">
                <div className="stat-value">{stats.verifiedContacts}</div>
                <div className="stat-label">Verified</div>
              </div>
            </div>
            <div className="stat-card metal-card">
              <div className="stat-icon">⭐</div>
              <div className="stat-content">
                <div className="stat-value">{stats.highPriority}</div>
                <div className="stat-label">High Priority</div>
              </div>
            </div>
            <div className="stat-card metal-card">
              <div className="stat-icon">🆕</div>
              <div className="stat-content">
                <div className="stat-value">{stats.recentContacts}</div>
                <div className="stat-label">This Week</div>
              </div>
            </div>
          </div>
        </div>

        <div className="contacts-section metal-section">
          <div className="section-header">
            <h2>Encrypted Contacts</h2>
            <div className="search-container">
              <input
                type="text"
                placeholder="Search contacts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input metal-input"
              />
              <button 
                onClick={loadData} 
                className="refresh-btn metal-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "🔄" : "↻"}
              </button>
            </div>
          </div>
          
          <div className="contacts-grid">
            {filteredContacts.length === 0 ? (
              <div className="no-contacts metal-card">
                <div className="no-contents-icon">📇</div>
                <p>No contacts found</p>
                <button 
                  className="create-btn metal-btn primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Contact
                </button>
              </div>
            ) : filteredContacts.map((contact) => (
              <div 
                className={`contact-card metal-card ${selectedContact?.id === contact.id ? "selected" : ""} ${contact.isVerified ? "verified" : ""}`}
                key={contact.id}
                onClick={() => setSelectedContact(contact)}
              >
                <div className="contact-header">
                  <div className="contact-avatar">
                    {contact.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="contact-info">
                    <h3>{contact.name}</h3>
                    <span className="contact-email">{contact.email}</span>
                  </div>
                  <div className={`contact-status ${contact.isVerified ? "verified" : "encrypted"}`}>
                    {contact.isVerified ? "✅" : "🔒"}
                  </div>
                </div>
                <div className="contact-details">
                  <p>{contact.description}</p>
                  <div className="contact-meta">
                    <span>Priority: {contact.publicValue1}/10</span>
                    <span>{new Date(contact.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <CreateContactModal 
          onSubmit={createContact} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingContact} 
          contactData={newContactData} 
          setContactData={setNewContactData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedContact && (
        <ContactDetailModal 
          contact={selectedContact} 
          onClose={() => { 
            setSelectedContact(null); 
            setDecryptedData({ phoneNumber: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptContact(selectedContact.id)}
        />
      )}
      
      {showHistory && (
        <HistoryModal 
          operations={operationHistory}
          onClose={() => setShowHistory(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal metal-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateContactModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  contactData: any;
  setContactData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, contactData, setContactData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'phoneNumber') {
      const digitsOnly = value.replace(/\D/g, '');
      setContactData({ ...contactData, [name]: digitsOnly });
    } else {
      setContactData({ ...contactData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay metal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>New Encrypted Contact</h2>
          <button onClick={onClose} className="close-modal metal-close">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice metal-notice">
            <strong>FHE 🔐 Phone Number Encryption</strong>
            <p>Phone number will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Name *</label>
            <input 
              type="text" 
              name="name" 
              value={contactData.name} 
              onChange={handleChange} 
              className="metal-input"
              placeholder="Enter contact name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Phone Number (Digits only) *</label>
            <input 
              type="tel" 
              name="phoneNumber" 
              value={contactData.phoneNumber} 
              onChange={handleChange} 
              className="metal-input"
              placeholder="Enter phone number..." 
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Email</label>
            <input 
              type="email" 
              name="email" 
              value={contactData.email} 
              onChange={handleChange} 
              className="metal-input"
              placeholder="Enter email..." 
            />
          </div>
          
          <div className="form-group">
            <label>Priority (1-10)</label>
            <input 
              type="number" 
              min="1" 
              max="10" 
              name="priority" 
              value={contactData.priority} 
              onChange={handleChange} 
              className="metal-input"
            />
            <div className="data-type-label">Public Data</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={contactData.description} 
              onChange={handleChange} 
              className="metal-input"
              placeholder="Additional notes..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !contactData.name || !contactData.phoneNumber} 
            className="submit-btn metal-btn primary"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Contact"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ContactDetailModal: React.FC<{
  contact: ContactData;
  onClose: () => void;
  decryptedData: { phoneNumber: number | null };
  setDecryptedData: (value: { phoneNumber: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ contact, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData.phoneNumber !== null) { 
      setDecryptedData({ phoneNumber: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ phoneNumber: decrypted });
    }
  };

  return (
    <div className="modal-overlay metal-overlay">
      <div className="detail-modal metal-card">
        <div className="modal-header">
          <h2>Contact Details</h2>
          <button onClick={onClose} className="close-modal metal-close">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="contact-header">
            <div className="contact-avatar large">
              {contact.name.charAt(0).toUpperCase()}
            </div>
            <div className="contact-info">
              <h3>{contact.name}</h3>
              <span className="contact-email">{contact.email}</span>
            </div>
          </div>
          
          <div className="contact-details">
            <div className="detail-item">
              <label>Description:</label>
              <p>{contact.description}</p>
            </div>
            
            <div className="detail-item">
              <label>Priority:</label>
              <span className="priority-badge">{contact.publicValue1}/10</span>
            </div>
            
            <div className="detail-item">
              <label>Created:</label>
              <span>{new Date(contact.timestamp * 1000).toLocaleString()}</span>
            </div>
            
            <div className="detail-item">
              <label>Creator:</label>
              <span className="creator-address">{contact.creator}</span>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>Phone Number Encryption</h3>
            <div className="encryption-status">
              <div className="status-item">
                <span>Encryption Status:</span>
                <strong>{contact.isVerified ? "✅ On-chain Verified" : "🔒 FHE Encrypted"}</strong>
              </div>
              
              <div className="phone-number-display">
                <label>Phone Number:</label>
                <div className="phone-value">
                  {contact.isVerified && contact.decryptedValue ? 
                    contact.decryptedValue : 
                    decryptedData.phoneNumber !== null ? 
                    decryptedData.phoneNumber : 
                    "🔒 Encrypted (FHE Protected)"
                  }
                </div>
              </div>
              
              <button 
                className={`decrypt-btn metal-btn ${(contact.isVerified || decryptedData.phoneNumber !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "🔓 Decrypting..." :
                 contact.isVerified ? "✅ Verified" :
                 decryptedData.phoneNumber !== null ? "🔄 Re-verify" :
                 "🔓 Decrypt Phone Number"}
              </button>
            </div>
            
            <div className="fhe-info metal-notice">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Protected Data</strong>
                <p>Phone number is encrypted on-chain using Zama FHE technology</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

const HistoryModal: React.FC<{
  operations: OperationHistory[];
  onClose: () => void;
}> = ({ operations, onClose }) => {
  return (
    <div className="modal-overlay metal-overlay">
      <div className="history-modal metal-card">
        <div className="modal-header">
          <h2>Operation History</h2>
          <button onClick={onClose} className="close-modal metal-close">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="history-list">
            {operations.length === 0 ? (
              <div className="no-history">
                <p>No operations recorded yet</p>
              </div>
            ) : (
              operations.map((op) => (
                <div key={op.id} className={`history-item ${op.status}`}>
                  <div className="item-icon">
                    {op.type === 'create' && '➕'}
                    {op.type === 'verify' && '✅'}
                    {op.type === 'decrypt' && '🔓'}
                  </div>
                  <div className="item-content">
                    <div className="item-title">
                      {op.type.charAt(0).toUpperCase() + op.type.slice(1)}: {op.contactName}
                    </div>
                    <div className="item-time">
                      {new Date(op.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <div className={`item-status ${op.status}`}>
                    {op.status === 'success' ? '✓' : '✗'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;


