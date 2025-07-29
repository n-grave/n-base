import { ethers } from 'ethers';
import { generateDepositAddress, monitorDeposit, purchaseBaseName, checkNameAvailability, getNamePrice } from '../utils/baseNames.js';
import { trackRequest, getRequestsByInboxId } from '../utils/requestTracker.js';

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
  const { address, price, path, expiresAt } = await generateDepositAddress(baseName, message.senderInboxId);
  
  // Track the request
  await trackRequest({
    inboxId: message.senderInboxId,
    baseName,
    depositAddress: address,
    price,
    path,
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
  monitorPayment(conversation, address, baseName, price, message.senderInboxId, path);
}

async function monitorPayment(conversation, address, baseName, price, inboxId, path) {
  try {
    const result = await monitorDeposit(address, price, 30 * 60 * 1000); // 30 min timeout
    
    if (result.success) {
      await conversation.send(
        `✅ Payment received! Purchasing ${baseName}...`
      );
      
      const txHash = await purchaseBaseName(baseName, result.from, path, address);
      
      await conversation.send(
        `🎉 Success! ${baseName} has been registered!\n\n` +
        `Transaction: https://basescan.org/tx/${txHash}\n` +
        `Owner: ${result.from}\n\n` +
        `Your Base name is now active! 🚀`
      );
      
      // Update tracking
      await trackRequest({
        inboxId,
        baseName,
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