// ===== PACKAGE.JSON =====
// package.json
{
  "name": "xmtp-shade-agent",
  "version": "1.0.0",
  "type": "module",
  "description": "XMTP-based Shade Agent for Base name purchases",
  "main": "worker/index.js",
  "scripts": {
    "start": "node worker/index.js",
    "dev": "NODE_ENV=development node worker/index.js",
    "test": "jest",
    "docker:build": "docker build -t xmtp-shade-agent .",
    "docker:push": "docker push yourhub/xmtp-shade-agent:latest"
  },
  "dependencies": {
    "@xmtp/node-sdk": "^2.0.6",
    "@xmtp/content-type-text": "^1.1.9",
    "@xmtp/content-type-attachment": "^1.0.0",
    "@xmtp/content-type-read-receipt": "^1.0.0",
    "ethers": "^6.9.0",
    "dotenv": "^16.3.1",
    "p-queue": "^7.4.1"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}

// ===== XMTP SIGNER =====
// xmtp/signer.js
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

// ===== XMTP CLIENT =====
// xmtp/client.js
import { Client } from '@xmtp/node-sdk';
import { createEOASigner } from './signer.js';
import { getRandomValues } from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';

const DB_ENCRYPTION_KEY_FILE = '.xmtp-encryption-key';

async function getOrCreateEncryptionKey() {
  try {
    // Try to read existing key
    const keyHex = await fs.readFile(DB_ENCRYPTION_KEY_FILE, 'utf8');
    return new Uint8Array(Buffer.from(keyHex.trim(), 'hex'));
  } catch (error) {
    // Generate new key if doesn't exist
    const key = getRandomValues(new Uint8Array(32));
    const keyHex = Buffer.from(key).toString('hex');
    await fs.writeFile(DB_ENCRYPTION_KEY_FILE, keyHex);
    console.log('Generated new DB encryption key');
    return key;
  }
}

export async function setupXMTPClient(privateKey, options = {}) {
  const signer = createEOASigner(privateKey);
  const dbEncryptionKey = await getOrCreateEncryptionKey();
  
  // Check if we should build existing client
  const dbPath = options.dbPath || './xmtp-db';
  const dbExists = await fs.access(dbPath).then(() => true).catch(() => false);
  
  let client;
  if (dbExists) {
    console.log('Building existing XMTP client...');
    const identity = signer.getIdentity();
    client = await Client.build(identity, {
      env: process.env.XMTP_ENV || 'production',
      dbEncryptionKey,
      dbPath,
      ...options
    });
  } else {
    console.log('Creating new XMTP client...');
    client = await Client.create(signer, {
      env: process.env.XMTP_ENV || 'production',
      dbEncryptionKey,
      dbPath,
      ...options
    });
  }
  
  return client;
}

// ===== MESSAGE MONITOR =====
// xmtp/monitor.js
import PQueue from 'p-queue';

export async function monitorConversations(client, handler) {
  // Create a queue to process messages sequentially
  const queue = new PQueue({ concurrency: 1 });
  
  // Sync all conversations first
  console.log('Syncing conversations...');
  await client.conversations.syncAll();
  
  // Get existing conversations
  const conversations = await client.conversations.list();
  console.log(`Found ${conversations.length} existing conversations`);
  
  // Stream all messages
  const stream = await client.conversations.streamAllMessages();
  
  console.log('Monitoring XMTP messages...');
  
  try {
    for await (const message of stream) {
      // Skip messages from self
      if (message.senderInboxId === client.inboxId) continue;
      
      // Add to processing queue
      queue.add(async () => {
        try {
          await handler(message);
        } catch (error) {
          console.error('Error handling message:', error);
        }
      });
    }
  } catch (error) {
    console.error('Stream error:', error);
    // Attempt to reconnect after error
    setTimeout(() => monitorConversations(client, handler), 5000);
  }
}

// Stream new conversations
export async function streamNewConversations(client, handler) {
  const stream = await client.conversations.stream();
  
  console.log('Listening for new conversations...');
  
  try {
    for await (const conversation of stream) {
      console.log('New conversation started:', conversation.id);
      await handler(conversation);
    }
  } catch (error) {
    console.error('Conversation stream error:', error);
  }
}

// ===== MESSAGE HANDLER =====
// xmtp/messageHandler.js
import { ethers } from 'ethers';
import { generateDepositAddress, monitorDeposit, purchaseBaseName } from '../utils/baseNames.js';
import { trackRequest } from '../utils/requestTracker.js';

const RATE_LIMIT_WINDOW = 60000; // 1 minute
const rateLimiter = new Map();

function checkRateLimit(inboxId) {
  const now = Date.now();
  const lastRequest = rateLimiter.get(inboxId);
  
  if (lastRequest && now - lastRequest < RATE_LIMIT_WINDOW) {
    return false;
  }
  
  rateLimiter.set(inboxId, now);
  return true;
}

export async function handleMessage(client, message) {
  try {
    const content = message.content;
    const conversation = await client.conversations.findConversationById(
      message.conversationId
    );
    
    // Check rate limit
    if (!checkRateLimit(message.senderInboxId)) {
      await conversation.send('Please wait a moment before sending another request.');
      return;
    }
    
    // Parse commands
    const command = content.toLowerCase().trim();
    
    if (command.startsWith('buy ')) {
      await handleBuyCommand(conversation, message, content);
    } else if (command === 'help') {
      await sendHelpMessage(conversation);
    } else if (command === 'status') {
      await handleStatusCommand(conversation, message);
    } else if (command.startsWith('check ')) {
      await handleCheckCommand(conversation, content);
    } else {
      await conversation.send(
        "I didn't understand that command. Type 'help' for available commands."
      );
    }
  } catch (error) {
    console.error('Error in handleMessage:', error);
    throw error;
  }
}

async function handleBuyCommand(conversation, message, content) {
  const baseName = parseBaseName(content);
  
  if (!baseName) {
    await conversation.send(
      'Invalid format. Please use: buy yourname.base.eth\n' +
      'Example: buy coolname.base.eth'
    );
    return;
  }
  
  // Check if name is available
  const isAvailable = await checkNameAvailability(baseName);
  if (!isAvailable) {
    await conversation.send(
      `Sorry, ${baseName} is already taken. Try a different name!`
    );
    return;
  }
  
  // Generate deposit address
  const { address, price, expiresAt } = await generateDepositAddress(baseName);
  
  // Track the request
  await trackRequest({
    inboxId: message.senderInboxId,
    baseName,
    depositAddress: address,
    price,
    status: 'pending',
    createdAt: new Date()
  });
  
  // Send payment instructions
  await conversation.send(
    `🎯 Ready to register ${baseName}!\n\n` +
    `📍 Send exactly ${price} ETH on Base to:\n` +
    `${address}\n\n` +
    `⏱️ This address expires in 30 minutes.\n` +
    `💡 Need Base ETH? Bridge at bridge.base.org\n\n` +
    `I'll purchase ${baseName} once payment is confirmed!`
  );
  
  // Monitor for payment in background
  monitorPayment(conversation, address, baseName, price, message.senderInboxId);
}

async function monitorPayment(conversation, address, baseName, price, inboxId) {
  try {
    const result = await monitorDeposit(address, price, 30 * 60 * 1000); // 30 min timeout
    
    if (result.success) {
      await conversation.send(
        `✅ Payment received! Purchasing ${baseName}...`
      );
      
      const txHash = await purchaseBaseName(baseName, result.from);
      
      await conversation.send(
        `🎉 Success! ${baseName} has been registered!\n\n` +
        `Transaction: https://basescan.org/tx/${txHash}\n` +
        `Owner: ${result.from}\n\n` +
        `Your Base name is now active! 🚀`
      );
      
      // Update tracking
      await trackRequest({
        inboxId,
        status: 'completed',
        txHash,
        completedAt: new Date()
      });
    }
  } catch (error) {
    console.error('Payment monitoring error:', error);
    await conversation.send(
      `❌ Error processing payment: ${error.message}\n` +
      `Please contact support if you've sent payment.`
    );
  }
}

async function handleStatusCommand(conversation, message) {
  const requests = await getRequestsByInboxId(message.senderInboxId);
  
  if (requests.length === 0) {
    await conversation.send("You don't have any Base name requests yet.");
    return;
  }
  
  let statusMessage = '📊 Your Base name requests:\n\n';
  
  for (const req of requests) {
    statusMessage += `• ${req.baseName}\n`;
    statusMessage += `  Status: ${req.status}\n`;
    if (req.txHash) {
      statusMessage += `  TX: https://basescan.org/tx/${req.txHash}\n`;
    }
    statusMessage += '\n';
  }
  
  await conversation.send(statusMessage);
}

async function handleCheckCommand(conversation, content) {
  const name = parseBaseName(content.replace('check ', ''));
  
  if (!name) {
    await conversation.send('Please specify a valid Base name to check.');
    return;
  }
  
  const isAvailable = await checkNameAvailability(name);
  const price = await getNamePrice(name);
  
  await conversation.send(
    `📍 ${name}\n` +
    `Status: ${isAvailable ? '✅ Available' : '❌ Taken'}\n` +
    `Price: ${price} ETH\n` +
    `${isAvailable ? "\nType 'buy " + name + "' to register!" : ''}`
  );
}

async function sendHelpMessage(conversation) {
  await conversation.send(
    '👋 I help you register Base names!\n\n' +
    '📝 Commands:\n' +
    '• buy yourname.base.eth - Register a name\n' +
    '• check name.base.eth - Check availability\n' +
    '• status - View your requests\n' +
    '• help - Show this message\n\n' +
    '💡 Base names let you have a human-readable address!\n' +
    'Questions? Visit base.org/names'
  );
}

function parseBaseName(content) {
  const match = content.match(/(\w+)\.base\.eth/i);
  if (!match) return null;
  
  const name = match[1].toLowerCase();
  // Validate name (alphanumeric, min 3 chars)
  if (!/^[a-z0-9]{3,}$/.test(name)) return null;
  
  return `${name}.base.eth`;
}

// Placeholder functions - implement these based on your Base integration
async function checkNameAvailability(name) {
  // Implement Base name availability check
  return true;
}

async function getNamePrice(name) {
  // Implement Base name pricing logic
  const length = name.split('.')[0].length;
  if (length <= 3) return '0.1';
  if (length === 4) return '0.05';
  return '0.01';
}

// ===== REQUEST TRACKER =====
// utils/requestTracker.js
const requests = new Map();

export async function trackRequest(data) {
  const key = `${data.inboxId}-${data.baseName}`;
  requests.set(key, { ...requests.get(key), ...data });
}

export async function getRequestsByInboxId(inboxId) {
  const userRequests = [];
  for (const [key, value] of requests) {
    if (key.startsWith(inboxId)) {
      userRequests.push(value);
    }
  }
  return userRequests.sort((a, b) => b.createdAt - a.createdAt);
}

// ===== BASE NAME UTILITIES =====
// utils/baseNames.js
import { ethers } from 'ethers';

// Generate deterministic deposit address
export async function generateDepositAddress(baseName) {
  // In production, use proper key derivation
  const depositId = ethers.id(`${baseName}-${Date.now()}`);
  const wallet = new ethers.Wallet(depositId.slice(0, 66));
  
  return {
    address: wallet.address,
    price: await getNamePrice(baseName),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000)
  };
}

// Monitor blockchain for deposits
export async function monitorDeposit(address, expectedAmount, timeout) {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
  const endTime = Date.now() + timeout;
  
  while (Date.now() < endTime) {
    const balance = await provider.getBalance(address);
    
    if (balance >= ethers.parseEther(expectedAmount)) {
      // Get sender from transaction
      const block = await provider.getBlock('latest');
      // In production, properly track the sender
      return {
        success: true,
        amount: ethers.formatEther(balance),
        from: '0x...' // Get actual sender
      };
    }
    
    // Wait 5 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  throw new Error('Payment timeout');
}

// Purchase Base name using NEAR chain signatures
export async function purchaseBaseName(baseName, recipientAddress) {
  // Implement actual Base name purchase logic
  // This would use NEAR chain signatures as in the original template
  console.log(`Purchasing ${baseName} for ${recipientAddress}`);
  
  // Return mock transaction hash
  return '0x' + ethers.randomBytes(32).toString('hex');
}

async function getNamePrice(name) {
  const length = name.split('.')[0].length;
  if (length <= 3) return '0.1';
  if (length === 4) return '0.05';
  return '0.01';
}

// ===== MAIN WORKER =====
// worker/index.js
import 'dotenv/config';
import { setupXMTPClient } from '../xmtp/client.js';
import { monitorConversations, streamNewConversations } from '../xmtp/monitor.js';
import { handleMessage } from '../xmtp/messageHandler.js';

async function main() {
  if (!process.env.AGENT_PRIVATE_KEY) {
    throw new Error('AGENT_PRIVATE_KEY environment variable is required');
  }
  
  console.log('Starting XMTP Shade Agent...');
  
  // Setup XMTP client
  const client = await setupXMTPClient(process.env.AGENT_PRIVATE_KEY);
  
  console.log('=================================');
  console.log('XMTP Agent Started Successfully!');
  console.log('=================================');
  console.log('Inbox ID:', client.inboxId);
  console.log('Address:', (await client.accountAddresses())[0]);
  console.log('Environment:', process.env.XMTP_ENV || 'production');
  console.log('=================================');
  
  // Handle new conversations
  streamNewConversations(client, async (conversation) => {
    console.log('New conversation started');
    // Send welcome message
    await conversation.send(
      '👋 Welcome! I help you register Base names.\n' +
      "Type 'help' to see available commands."
    );
  });
  
  // Monitor all conversations for messages
  await monitorConversations(client, async (message) => {
    console.log(`Message from ${message.senderInboxId}: ${message.content}`);
    await handleMessage(client, message);
  });
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

// Start the agent
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// ===== DOCKERFILE =====
// Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create data directory
RUN mkdir -p xmtp-db

# Run as non-root user
USER node

# Start the agent
CMD ["node", "worker/index.js"]

// ===== DOCKER COMPOSE =====
// docker-compose.yaml
version: '3.8'

services:
  xmtp-agent:
    build: .
    image: ${DOCKER_REGISTRY}/xmtp-shade-agent:${VERSION:-latest}
    environment:
      - NODE_ENV=production
      - AGENT_PRIVATE_KEY=${AGENT_PRIVATE_KEY}
      - XMTP_ENV=${XMTP_ENV:-production}
      - BASE_RPC_URL=${BASE_RPC_URL}
      - BASE_API_KEY=${BASE_API_KEY}
      - MPC_PUBLIC_KEY_MAINNET=${MPC_PUBLIC_KEY_MAINNET}
      - NEXT_PUBLIC_contractId=${NEXT_PUBLIC_contractId}
    volumes:
      - xmtp-data:/app/xmtp-db
      - ./logs:/app/logs
    restart: unless-stopped
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  xmtp-data:

// ===== ENVIRONMENT TEMPLATE =====
// .env.example
# XMTP Configuration
AGENT_PRIVATE_KEY=your_agent_wallet_private_key_here
XMTP_ENV=production  # Use 'dev' for testing

# Base Network Configuration  
BASE_RPC_URL=https://mainnet.base.org
BASE_API_KEY=your_basescan_api_key

# NEAR MPC Configuration
MPC_PUBLIC_KEY_MAINNET=your_mpc_public_key
NEXT_PUBLIC_contractId=your_shade_agent_contract.near

# Docker Registry (optional)
DOCKER_REGISTRY=yourdockerhub

# ===== TEST FILE =====
// test/xmtp.test.js
import { setupXMTPClient } from '../xmtp/client.js';
import { Wallet } from 'ethers';

describe('XMTP Shade Agent', () => {
  let agentClient, userClient;
  let agentWallet, userWallet;
  
  beforeAll(async () => {
    // Create test wallets
    agentWallet = Wallet.createRandom();
    userWallet = Wallet.createRandom();
    
    // Setup clients
    agentClient = await setupXMTPClient(agentWallet.privateKey, {
      env: 'dev',
      dbPath: './test-db-agent'
    });
    
    userClient = await setupXMTPClient(userWallet.privateKey, {
      env: 'dev',
      dbPath: './test-db-user'
    });
  });
  
  afterAll(async () => {
    // Cleanup
    await agentClient.close();
    await userClient.close();
  });
  
  test('should create XMTP clients', () => {
    expect(agentClient.inboxId).toBeDefined();
    expect(userClient.inboxId).toBeDefined();
  });
  
  test('should send and receive messages', async () => {
    // Create DM conversation
    const dm = await userClient.conversations.newDm(agentClient.inboxId);
    
    // Send message
    await dm.send('Hello agent!');
    
    // Agent should receive it
    await agentClient.conversations.syncAll();
    const agentConvos = await agentClient.conversations.list();
    expect(agentConvos.length).toBe(1);
    
    const messages = await agentConvos[0].messages();
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('Hello agent!');
  });
  
  test('should handle buy command', async () => {
    const dm = await userClient.conversations.newDm(agentClient.inboxId);
    await dm.send('buy test.base.eth');
    
    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
    await dm.sync();
    
    const messages = await dm.messages();
    const response = messages.find(m => m.senderInboxId === agentClient.inboxId);
    
    expect(response).toBeDefined();
    expect(response.content).toContain('Send');
    expect(response.content).toContain('ETH');
  });
});