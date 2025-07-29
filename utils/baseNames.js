import { ethers } from 'ethers';
import { generateAddress, networkId, contractCall } from '@neardefi/shade-agent-js';
import evm from './evm.js';

// Generate deterministic deposit address using NEAR chain signatures
export async function generateDepositAddress(baseName, authorId) {
  const path = `${authorId}-${baseName}`;
  
  // Use NEAR chain signatures to generate address
  const { address } = await generateAddress({
    publicKey:
      networkId === 'testnet'
        ? process.env.MPC_PUBLIC_KEY_TESTNET
        : process.env.MPC_PUBLIC_KEY_MAINNET,
    accountId: process.env.NEXT_PUBLIC_contractId,
    path: path,
    chain: 'evm',
  });
  
  const price = await getNamePrice(baseName);
  
  return {
    address,
    price,
    path,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000)
  };
}

// Monitor blockchain for deposits
export async function monitorDeposit(address, expectedAmount, timeout) {
  const provider = new ethers.JsonRpcProvider(
    networkId === 'testnet'
      ? 'https://base-sepolia-rpc.publicnode.com'
      : 'https://base-rpc.publicnode.com'
  );
  
  const endTime = Date.now() + timeout;
  const expectedWei = ethers.parseEther(expectedAmount);
  
  while (Date.now() < endTime) {
    const balance = await provider.getBalance(address);
    
    if (balance >= expectedWei) {
      // Get the transaction that sent funds
      const latestBlock = await provider.getBlock('latest');
      let fromAddress = null;
      
      // Check recent blocks for transactions to this address
      for (let i = 0; i < 5; i++) {
        const block = await provider.getBlock(latestBlock.number - i, true);
        if (!block || !block.transactions) continue;
        
        for (const tx of block.transactions) {
          if (tx.to?.toLowerCase() === address.toLowerCase()) {
            fromAddress = tx.from;
            break;
          }
        }
        if (fromAddress) break;
      }
      
      return {
        success: true,
        amount: ethers.formatEther(balance),
        from: fromAddress || '0x0000000000000000000000000000000000000000'
      };
    }
    
    // Wait 5 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  throw new Error('Payment timeout');
}

// Purchase Base name using NEAR chain signatures
export async function purchaseBaseName(baseName, recipientAddress, path, depositAddress) {
  try {
    // Use the existing evm utility to purchase the basename
    const result = await evm.getBasenameTx(path, baseName, depositAddress, recipientAddress);
    
    if (result.success && result.hash) {
      return result.hash;
    }
    
    throw new Error(result.error || 'Failed to purchase Base name');
  } catch (error) {
    console.error('Error purchasing Base name:', error);
    throw error;
  }
}

// Check Base name availability
export async function checkNameAvailability(baseName) {
  const nameOnly = baseName.replace('.base.eth', '');
  const result = await evm.checkBasename(nameOnly);
  return result.isAvailable;
}

// Get price based on name length
export async function getNamePrice(baseName) {
  const nameOnly = baseName.replace('.base.eth', '');
  const length = nameOnly.length;
  
  // Price in ETH based on length
  if (length === 3) return '0.11';  // 110000000000000000n
  if (length === 4) return '0.011'; // 11000000000000000n
  return '0.0011'; // 1100000000000000n for 5+ chars
}