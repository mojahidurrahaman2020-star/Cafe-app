// Entry point of the ONLINE DEMO build only (see vite.demo.config.ts).
import { bootstrap } from '../bootstrap';
import { installDemoApi, resetDemo } from './mockApi';

installDemoApi();
bootstrap({ memoryRouter: true });

window.addEventListener('bb:demo-reset', () => {
  resetDemo();
  window.location.reload();
});
