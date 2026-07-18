import { emailProvider } from './emailProvider.js';
import { whatsappProvider } from './whatsappProvider.js';
import { pushProvider } from './pushProvider.js';
import { smsProvider } from './smsProvider.js';
import { inAppProvider } from './inAppProvider.js';
import { CHANNELS } from '../constants/index.js';

const providerRegistry = {
  [CHANNELS.EMAIL]: emailProvider,
  [CHANNELS.WHATSAPP]: whatsappProvider,
  [CHANNELS.SMS]: smsProvider,
  [CHANNELS.PUSH]: pushProvider,
  [CHANNELS.IN_APP]: inAppProvider,
};

export function getProvider(channel) {
  const provider = providerRegistry[channel];
  if (!provider) {
    throw new Error(`No provider registered for channel: ${channel}`);
  }
  return provider;
}

export function getAvailableChannels() {
  return Object.entries(providerRegistry)
    .filter(([, provider]) => provider.isAvailable())
    .map(([channel]) => channel);
}

export {
  emailProvider,
  whatsappProvider,
  pushProvider,
  smsProvider,
  inAppProvider,
};

export default providerRegistry;
