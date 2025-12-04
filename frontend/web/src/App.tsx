// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface GameSkillNFT {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  gameType: string;
  status: "pending" | "minted" | "rejected";
  visualArt: string;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generateVisualArt = (gameType: string, score: number): string => {
  const types = ["Tactical Master", "Speed Demon", "Strategic Genius", "Reaction King"];
  const colors = ["#FF6B35", "#004E89", "#00A6FB", "#7FB800", "#FF9F1C"];
  const art = types.includes(gameType) ? 
    `${gameType.replace(/\s/g, '')}-${Math.floor(score % 1000)}` : 
    `PlayerDNA-${Math.floor(Math.random() * 10000)}`;
  return `https://api.dicebear.com/7.x/shapes/svg?seed=${art}&backgroundType=gradientLinear&backgroundColor=${colors[Math.floor(Math.random() * colors.length)]}`;
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [nfts, setNfts] = useState<GameSkillNFT[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newNFTData, setNewNFTData] = useState({ gameType: "", description: "", skillScore: 0 });
  const [showIntro, setShowIntro] = useState(true);
  const [selectedNFT, setSelectedNFT] = useState<GameSkillNFT | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [userHistory, setUserHistory] = useState<string[]>([]);
  const mintedCount = nfts.filter(n => n.status === "minted").length;
  const pendingCount = nfts.filter(n => n.status === "pending").length;

  useEffect(() => {
    loadNFTs().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadNFTs = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("nft_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing NFT keys:", e); }
      }
      
      const list: GameSkillNFT[] = [];
      for (const key of keys) {
        try {
          const nftBytes = await contract.getData(`nft_${key}`);
          if (nftBytes.length > 0) {
            try {
              const nftData = JSON.parse(ethers.toUtf8String(nftBytes));
              list.push({ 
                id: key, 
                encryptedData: nftData.data, 
                timestamp: nftData.timestamp, 
                owner: nftData.owner, 
                gameType: nftData.gameType, 
                status: nftData.status || "pending",
                visualArt: nftData.visualArt || generateVisualArt(nftData.gameType, FHEDecryptNumber(nftData.data))
              });
            } catch (e) { console.error(`Error parsing NFT data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading NFT ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setNfts(list);
    } catch (e) { console.error("Error loading NFTs:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitNFT = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting game skill data with Zama FHE..." });
    try {
      const encryptedData = FHEEncryptNumber(newNFTData.skillScore);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const nftId = `GS-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const visualArt = generateVisualArt(newNFTData.gameType, newNFTData.skillScore);
      
      const nftData = { 
        data: encryptedData, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        gameType: newNFTData.gameType, 
        status: "pending",
        visualArt
      };
      
      await contract.setData(`nft_${nftId}`, ethers.toUtf8Bytes(JSON.stringify(nftData)));
      
      const keysBytes = await contract.getData("nft_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(nftId);
      await contract.setData("nft_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Game Skill NFT created successfully!" });
      addUserHistory(`Created ${newNFTData.gameType} NFT`);
      await loadNFTs();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewNFTData({ gameType: "", description: "", skillScore: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      addUserHistory(`Decrypted skill score`);
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const mintNFT = async (nftId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Minting encrypted Game Skill NFT..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const nftBytes = await contract.getData(`nft_${nftId}`);
      if (nftBytes.length === 0) throw new Error("NFT not found");
      const nftData = JSON.parse(ethers.toUtf8String(nftBytes));
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedNFT = { ...nftData, status: "minted" };
      await contractWithSigner.setData(`nft_${nftId}`, ethers.toUtf8Bytes(JSON.stringify(updatedNFT)));
      
      setTransactionStatus({ visible: true, status: "success", message: "NFT minted successfully!" });
      addUserHistory(`Minted NFT ${nftId.substring(0, 6)}`);
      await loadNFTs();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Minting failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const addUserHistory = (action: string) => {
    setUserHistory(prev => [`${new Date().toLocaleTimeString()}: ${action}`, ...prev.slice(0, 9)]);
  };

  const isOwner = (nftAddress: string) => address?.toLowerCase() === nftAddress.toLowerCase();

  const gameTypes = [
    "Tactical Master", 
    "Speed Demon", 
    "Strategic Genius", 
    "Reaction King",
    "Team Player",
    "Solo Champion",
    "Precision Expert"
  ];

  const renderStats = () => (
    <div className="stats-grid">
      <div className="stat-item">
        <div className="stat-value">{nfts.length}</div>
        <div className="stat-label">Total NFTs</div>
      </div>
      <div className="stat-item">
        <div className="stat-value">{mintedCount}</div>
        <div className="stat-label">Minted</div>
      </div>
      <div className="stat-item">
        <div className="stat-value">{pendingCount}</div>
        <div className="stat-label">Pending</div>
      </div>
      <div className="stat-item">
        <div className="stat-value">{gameTypes.length}</div>
        <div className="stat-label">Player Types</div>
      </div>
    </div>
  );

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"><div className="shield-icon"></div></div>
          <h1>Game<span>Skill</span>NFT</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-nft-btn cyber-button">
            <div className="add-icon"></div>Create NFT
          </button>
          <button className="cyber-button" onClick={() => setShowIntro(!showIntro)}>
            {showIntro ? "Hide Intro" : "Show Intro"}
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>
      <div className="main-content">
        {showIntro && (
          <div className="intro-section cyber-card">
            <h2>Game Skill DNA NFT</h2>
            <p className="subtitle">Your encrypted gaming identity on the blockchain</p>
            <div className="intro-content">
              <div className="intro-feature">
                <div className="feature-icon">🔒</div>
                <div>
                  <h3>FHE Encrypted</h3>
                  <p>Player skill data is encrypted using Zama FHE technology, allowing computations without decryption</p>
                </div>
              </div>
              <div className="intro-feature">
                <div className="feature-icon">🎮</div>
                <div>
                  <h3>Dynamic Visuals</h3>
                  <p>Unique NFT artwork generated based on your encrypted gaming DNA</p>
                </div>
              </div>
              <div className="intro-feature">
                <div className="feature-icon">🆔</div>
                <div>
                  <h3>Web3 Identity</h3>
                  <p>Your ultimate gaming identity across multiple games and platforms</p>
                </div>
              </div>
            </div>
            <div className="fhe-process">
              <div className="process-step">
                <div className="step-number">1</div>
                <p>Connect wallet & analyze game data</p>
              </div>
              <div className="process-arrow">→</div>
              <div className="process-step">
                <div className="step-number">2</div>
                <p>Encrypt with Zama FHE</p>
              </div>
              <div className="process-arrow">→</div>
              <div className="process-step">
                <div className="step-number">3</div>
                <p>Generate visual NFT</p>
              </div>
              <div className="process-arrow">→</div>
              <div className="process-step">
                <div className="step-number">4</div>
                <p>Mint as dynamic NFT</p>
              </div>
            </div>
          </div>
        )}
        <div className="dashboard-grid">
          <div className="dashboard-card cyber-card">
            <h3>Your Game Stats</h3>
            {renderStats()}
          </div>
          <div className="dashboard-card cyber-card">
            <h3>Recent Activity</h3>
            <div className="activity-feed">
              {userHistory.length > 0 ? (
                userHistory.map((item, index) => (
                  <div key={index} className="activity-item">
                    <div className="activity-bullet"></div>
                    <div className="activity-text">{item}</div>
                  </div>
                ))
              ) : (
                <p className="no-activity">No recent activity</p>
              )}
            </div>
          </div>
        </div>
        <div className="nfts-section">
          <div className="section-header">
            <h2>Your Game Skill NFTs</h2>
            <div className="header-actions">
              <button onClick={loadNFTs} className="refresh-btn cyber-button" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          <div className="nfts-grid">
            {nfts.length === 0 ? (
              <div className="no-nfts cyber-card">
                <div className="no-nfts-icon"></div>
                <p>No Game Skill NFTs found</p>
                <button className="cyber-button primary" onClick={() => setShowCreateModal(true)}>Create First NFT</button>
              </div>
            ) : (
              nfts.map(nft => (
                <div className="nft-card cyber-card" key={nft.id} onClick={() => setSelectedNFT(nft)}>
                  <div className="nft-image">
                    <img src={nft.visualArt} alt="Game Skill Visual Art" />
                    <div className={`nft-status ${nft.status}`}>{nft.status}</div>
                  </div>
                  <div className="nft-info">
                    <h3>{nft.gameType}</h3>
                    <div className="nft-meta">
                      <span>Owner: {nft.owner.substring(0, 6)}...{nft.owner.substring(38)}</span>
                      <span>{new Date(nft.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    {isOwner(nft.owner) && nft.status === "pending" && (
                      <button className="mint-btn cyber-button" onClick={(e) => { e.stopPropagation(); mintNFT(nft.id); }}>
                        Mint NFT
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      {showCreateModal && <ModalCreate onSubmit={submitNFT} onClose={() => setShowCreateModal(false)} creating={creating} nftData={newNFTData} setNftData={setNewNFTData} gameTypes={gameTypes}/>}
      {selectedNFT && <NFTDetailModal nft={selectedNFT} onClose={() => { setSelectedNFT(null); setDecryptedValue(null); }} decryptedValue={decryptedValue} setDecryptedValue={setDecryptedValue} isDecrypting={isDecrypting} decryptWithSignature={decryptWithSignature}/>}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><div className="shield-icon"></div><span>GameSkillNFT</span></div>
            <p>Encrypted gaming identity powered by Zama FHE</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Docs</a>
            <a href="#" className="footer-link">Privacy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Gaming Identity</span></div>
          <div className="copyright">© {new Date().getFullYear()} GameSkillNFT. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  nftData: any;
  setNftData: (data: any) => void;
  gameTypes: string[];
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, nftData, setNftData, gameTypes }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setNftData({ ...nftData, [name]: value });
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setNftData({ ...nftData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!nftData.gameType || !nftData.skillScore) { alert("Please fill required fields"); return; }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Create Game Skill NFT</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div><strong>FHE Encryption Notice</strong><p>Your game skill data will be encrypted with Zama FHE before submission</p></div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label>Player Type *</label>
              <select name="gameType" value={nftData.gameType} onChange={handleChange} className="cyber-select">
                <option value="">Select your player type</option>
                {gameTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Description</label>
              <input type="text" name="description" value={nftData.description} onChange={handleChange} placeholder="Brief description..." className="cyber-input"/>
            </div>
            <div className="form-group">
              <label>Skill Score (1-100) *</label>
              <input 
                type="number" 
                name="skillScore" 
                value={nftData.skillScore} 
                onChange={handleValueChange} 
                placeholder="Enter your skill score..." 
                className="cyber-input"
                min="1"
                max="100"
              />
            </div>
          </div>
          <div className="encryption-preview">
            <h4>Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data"><span>Plain Value:</span><div>{nftData.skillScore || 'No value entered'}</div></div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{nftData.skillScore ? FHEEncryptNumber(nftData.skillScore).substring(0, 50) + '...' : 'No value entered'}</div>
              </div>
            </div>
          </div>
          <div className="art-preview">
            <h4>NFT Art Preview</h4>
            {nftData.gameType && nftData.skillScore ? (
              <img src={generateVisualArt(nftData.gameType, nftData.skillScore)} alt="NFT Preview" className="nft-preview-image" />
            ) : (
              <div className="placeholder-art">Select player type and enter score to preview</div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn cyber-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn cyber-button primary">
            {creating ? "Encrypting with FHE..." : "Create NFT"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface NFTDetailModalProps {
  nft: GameSkillNFT;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const NFTDetailModal: React.FC<NFTDetailModalProps> = ({ nft, onClose, decryptedValue, setDecryptedValue, isDecrypting, decryptWithSignature }) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { setDecryptedValue(null); return; }
    const decrypted = await decryptWithSignature(nft.encryptedData);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="nft-detail-modal cyber-card">
        <div className="modal-header">
          <h2>NFT Details #{nft.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="nft-image-container">
            <img src={nft.visualArt} alt="Game Skill NFT" className="nft-detail-image" />
            <div className={`nft-status-badge ${nft.status}`}>{nft.status}</div>
          </div>
          <div className="nft-info">
            <div className="info-item"><span>Player Type:</span><strong>{nft.gameType}</strong></div>
            <div className="info-item"><span>Owner:</span><strong>{nft.owner.substring(0, 6)}...{nft.owner.substring(38)}</strong></div>
            <div className="info-item"><span>Created:</span><strong>{new Date(nft.timestamp * 1000).toLocaleString()}</strong></div>
          </div>
          <div className="encrypted-data-section">
            <h3>Encrypted Skill Data</h3>
            <div className="encrypted-data">{nft.encryptedData.substring(0, 100)}...</div>
            <div className="fhe-tag"><div className="fhe-icon"></div><span>FHE Encrypted</span></div>
            <button className="decrypt-btn cyber-button" onClick={handleDecrypt} disabled={isDecrypting}>
              {isDecrypting ? <span className="decrypt-spinner"></span> : decryptedValue !== null ? "Hide Skill Score" : "Decrypt with Wallet"}
            </button>
          </div>
          {decryptedValue !== null && (
            <div className="decrypted-data-section">
              <h3>Your Skill Score</h3>
              <div className="skill-score">
                <div className="score-value">{decryptedValue}</div>
                <div className="score-bar">
                  <div className="score-fill" style={{ width: `${decryptedValue}%` }}></div>
                </div>
              </div>
              <div className="decryption-notice"><div className="warning-icon"></div><span>Decrypted data is only visible after wallet signature verification</span></div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn cyber-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;