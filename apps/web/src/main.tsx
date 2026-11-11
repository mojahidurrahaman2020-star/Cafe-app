import { registerSW } from 'virtual:pwa-register';
import { bootstrap } from './bootstrap';

// Service worker caches only the app shell so the UI can open and show OFFLINE status
// without a connection. It never caches API data.
if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}
bootstrap();
