import type { Permission } from '@bitebrew/shared';
import type { Icon } from '../components/Icons';

export interface NavItem {
  to: string;
  label: string;
  icon: keyof typeof Icon;
  permission: Permission;
  /** Extra permission needed to show the link in the sidebar (route still guarded by `permission`). */
  navAlsoRequires?: Permission;
  /** Roadmap phase in which the module becomes functional (undefined = available now). */
  phase?: number;
  section: 'Operations' | 'Back office' | 'Administration';
}

export const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard', permission: 'dashboard.view', section: 'Operations' },
  { to: '/pos', label: 'POS / Orders', icon: 'pos', permission: 'pos.use', phase: 3, section: 'Operations' },
  { to: '/kitchen', label: 'Kitchen', icon: 'kitchen', permission: 'kitchen.view', phase: 4, section: 'Operations' },
  { to: '/barista', label: 'Barista', icon: 'barista', permission: 'barista.view', phase: 4, section: 'Operations' },
  { to: '/availability', label: 'Availability', icon: 'availability', permission: 'menu.view', section: 'Operations' },
  { to: '/products', label: 'Menu items', icon: 'products', permission: 'menu.view', navAlsoRequires: 'inventory.view', section: 'Back office' },
  { to: '/menu', label: 'Menu categories', icon: 'menu', permission: 'menu.view', navAlsoRequires: 'menu.manage', section: 'Back office' },
  { to: '/inventory', label: 'Inventory', icon: 'inventory', permission: 'inventory.view', section: 'Back office' },
  { to: '/production', label: 'Production', icon: 'production', permission: 'production.manage', section: 'Back office' },
  { to: '/expenses', label: 'Purchases & expenses', icon: 'expenses', permission: 'expenses.manage', phase: 5, section: 'Back office' },
  { to: '/reports', label: 'Reports', icon: 'finance', permission: 'reports.view', phase: 5, section: 'Back office' },
  { to: '/printers', label: 'Printers', icon: 'printer', permission: 'printers.manage', phase: 4, section: 'Administration' },
  { to: '/users', label: 'Staff & roles', icon: 'users', permission: 'users.view', section: 'Administration' },
  { to: '/audit', label: 'Audit log', icon: 'audit', permission: 'audit.view', section: 'Administration' },
  { to: '/settings', label: 'Business settings', icon: 'settings', permission: 'settings.view', navAlsoRequires: 'dashboard.view', section: 'Administration' },
];
