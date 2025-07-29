import { Wallet } from 'ethers';

export function createEOASigner(privateKey) {
  const wallet = new Wallet(privateKey);
  
  return {
    type: "EOA",
    getIdentity: () => ({
      identifier: wallet.address.toLowerCase(),
      identifierKind: "Ethereum"
    }),
    signMessage: async (message) => {
      const signature = await wallet.signMessage(message);
      // Convert hex string to Uint8Array
      return new Uint8Array(Buffer.from(signature.slice(2), 'hex'));
    }
  };
}

export function createSCWSigner(wallet, chainId = 8453n) {
  return {
    type: "SCW",
    getIdentity: () => ({
      identifier: wallet.address.toLowerCase(),
      identifierKind: "Ethereum"
    }),
    signMessage: async (message) => {
      const signature = await wallet.signMessage(message);
      return new Uint8Array(Buffer.from(signature.slice(2), 'hex'));
    },
    getChainId: () => chainId
  };
}