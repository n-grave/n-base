// XMTP v3 Identity Management Utilities

export async function checkRegistrationStatus(client) {
  try {
    // Check if client has valid inbox ID
    if (!client.inboxId) {
      return {
        registered: false,
        error: 'No inbox ID found'
      };
    }
    
    // Get inbox state to verify registration
    const inboxState = await client.preferences.inboxState();
    
    // Check if we have at least one identifier
    if (!inboxState.identifiers || inboxState.identifiers.length === 0) {
      return {
        registered: false,
        error: 'No identifiers linked to inbox'
      };
    }
    
    // Check installations
    const hasValidInstallation = inboxState.installations.some(
      install => install.id === client.installationId
    );
    
    return {
      registered: true,
      inboxId: client.inboxId,
      installationId: client.installationId,
      address: inboxState.identifiers[0].identifier,
      installationCount: inboxState.installations.length,
      walletCount: inboxState.identifiers.length,
      hasValidInstallation
    };
  } catch (error) {
    return {
      registered: false,
      error: error.message
    };
  }
}

export async function displayIdentityInfo(client) {
  const status = await checkRegistrationStatus(client);
  
  if (!status.registered) {
    console.error('❌ Client not properly registered:', status.error);
    return;
  }
  
  console.log('\n📋 XMTP Identity Status:');
  console.log('✅ Registered on network');
  console.log(`🆔 Inbox ID: ${status.inboxId}`);
  console.log(`📱 Installation: ${status.installationId}`);
  console.log(`💰 Primary wallet: ${status.address}`);
  console.log(`📊 ${status.installationCount}/10 installations used`);
  console.log(`🔗 ${status.walletCount} wallet(s) linked`);
  
  if (status.installationCount >= 8) {
    console.warn('\n⚠️  Approaching installation limit!');
  }
}

// Helper to revoke old installations (for future use)
export async function revokeInstallation(client, installationId) {
  try {
    // This would revoke a specific installation
    // Implementation depends on XMTP SDK updates
    console.log(`Would revoke installation: ${installationId}`);
    console.log('Note: Installation revocation not yet implemented in SDK');
  } catch (error) {
    console.error('Failed to revoke installation:', error);
  }
}