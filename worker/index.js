import 'dotenv/config';
import { setupXMTPClient } from '../xmtp/client.js';
import { monitorConversations, streamNewConversations } from '../xmtp/monitor.js';
import { handleMessage } from '../xmtp/messageHandler.js';
import { checkRegistrationStatus, displayIdentityInfo } from '../xmtp/identity.js';

async function main() {
  if (!process.env.AGENT_PRIVATE_KEY) {
    throw new Error('AGENT_PRIVATE_KEY environment variable is required');
  }
  
  console.log('Starting XMTP Shade Agent...');
  
  // Setup XMTP client
  const client = await setupXMTPClient(process.env.AGENT_PRIVATE_KEY);
  
  // Get detailed client information
  const inboxState = await client.preferences.inboxState();
  const addresses = await client.accountAddresses();
  
  console.log('=================================');
  console.log('XMTP Agent Started Successfully!');
  console.log('=================================');
  console.log('🆔 Inbox ID:', client.inboxId);
  console.log('📬 Installation ID:', client.installationId);
  console.log('💰 Primary Address:', addresses[0]);
  console.log('🌐 Environment:', process.env.XMTP_ENV || 'production');
  console.log('📱 Installations:', `${inboxState.installations.length}/10`);
  console.log('🔗 Linked Wallets:', inboxState.identifiers.length);
  console.log('=================================');
  
  // Display all linked addresses
  if (inboxState.identifiers.length > 1) {
    console.log('Linked Addresses:');
    inboxState.identifiers.forEach((id, index) => {
      console.log(`  ${index + 1}. ${id.identifier}`);
    });
    console.log('=================================');
  }
  
  // Verify registration status
  const registrationStatus = await checkRegistrationStatus(client);
  if (!registrationStatus.registered) {
    throw new Error(`XMTP registration failed: ${registrationStatus.error}`);
  }
  
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