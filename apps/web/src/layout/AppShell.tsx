import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '@bitebrew/shared';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icons';
import { useAppInfo, useClock, useSettings } from '../lib/hooks';
import { useConnection } from '../realtime/ConnectionContext';
import { NAV } from './nav';

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export function StatusPill() {
  const c = useConnection();
  const cls = c.status === 'ONLINE' ? 'online' : c.status === 'DEGRADED' ? 'degraded' : 'offline';
  const title =
    c.status === 'ONLINE'
      ? 'Connected to the server; live updates active'
      : c.status === 'DEGRADED'
        ? 'Server reachable, live updates reconnecting'
        : !c.browserOnline
          ? 'This device has no network connection'
          : !c.serverReachable
            ? 'Cannot reach the Bite & Brew server'
            : 'Server is up but the database is unavailable';
  return (
    <span className={`status-pill ${cls}`} title={title} data-testid="connection-status">
      <span className="dot" />
      {c.status === 'DEGRADED' ? 'RECONNECTING' : c.status}
    </span>
  );
}

export function EnvBanner() {
  const info = useAppInfo();
  const env = info.data?.appEnv;
  if (!env || env === 'production') return null;
  return (
    <div className="env-banner" data-testid="env-banner">
      {env} environment — demo/sample data only, not for live café trading
    </div>
  );
}

export function AppShell() {
  const { user, can, logout } = useAuth();
  const settings = useSettings();
  const conn = useConnection();
  const tz = settings.data?.timezone ?? 'Asia/Dhaka';
  const clock = useClock(tz);
  const [drawer, setDrawer] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDrawer(false);
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  if (!user) return null;
  const items = NAV.filter((n) => can(n.permission) && (!n.navAlsoRequires || can(n.navAlsoRequires)));
  const sections = [...new Set(items.map((i) => i.section))];

  return (
    <div className={`shell ${drawer ? 'drawer-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <Link to="/" className="brand">
          <img src="/icon.svg" alt="" />
          <div>
            <div className="brand-name">{settings.data?.businessName ?? 'Bite & Brew'}</div>
            <div className="brand-tag">{settings.data?.tagline ?? 'Café & Hangout'}</div>
          </div>
        </Link>
        <nav className="nav">
          {sections.map((section) => (
            <div key={section} style={{ display: 'contents' }}>
              <div className="nav-section">{section}</div>
              {items
                .filter((i) => i.section === section)
                .map((item) => {
                  const I = Icon[item.icon];
                  return (
                    <NavLink key={item.to} to={item.to} data-testid={`nav-${item.to.slice(1)}`}>
                      <I />
                      <span>{item.label}</span>
                      {item.phase && <span className="phase">P{item.phase}</span>}
                    </NavLink>
                  );
                })}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">Est. {settings.data?.establishedYear ?? 2027} · {tz}</div>
      </aside>
      <div className="scrim" onClick={() => setDrawer(false)} />

      <div className="main">
        <EnvBanner />
        {conn.status === 'OFFLINE' && (
          <div className="offline-banner" role="alert" data-testid="offline-banner">
            <Icon.wifiOff width={22} />
            <span>
              OFFLINE —{' '}
              {!conn.browserOnline
                ? 'this device has lost its network connection.'
                : !conn.serverReachable
                  ? 'the Bite & Brew server cannot be reached.'
                  : 'the database is unavailable.'}{' '}
              Changes cannot be saved until the connection returns.
            </span>
          </div>
        )}
        <header className="topbar">
          <button className="btn ghost icon menu-btn" aria-label="Open navigation" onClick={() => setDrawer(true)} data-testid="menu-toggle">
            <Icon.burger width={24} />
          </button>
          <div>
            <div className="clock num">{clock.time}</div>
            <div className="tz">{clock.date} · {tz}</div>
          </div>
          <span className="spacer" />
          <StatusPill />
          <div ref={menuRef}>
            <button className="user-chip" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen} data-testid="user-menu">
              <span className="avatar">{initials(user.fullName)}</span>
              <span className="who">
                <b>{user.fullName}</b>
                <span>{ROLE_LABELS[user.role]}</span>
              </span>
            </button>
            {menuOpen && (
              <div className="menu-pop" role="menu">
                <Link to="/account" role="menuitem">
                  <Icon.key width={18} style={{ marginRight: 10 }} /> Change password
                </Link>
                <button
                  role="menuitem"
                  data-testid="logout"
                  onClick={async () => {
                    await logout();
                    navigate('/login', { replace: true });
                  }}
                >
                  <Icon.logout width={18} style={{ marginRight: 10 }} /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main id="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
