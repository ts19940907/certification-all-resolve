import { Platform } from 'react-native';

export type AppRoute =
  | { name: 'login'; next?: string }
  | { name: 'select' }
  | { name: 'settings'; certificationId?: string }
  | { name: 'admin' }
  | { name: 'main'; certificationId: string };

type Listener = () => void;

const listeners = new Set<Listener>();

function canUseWindow(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    typeof window.history !== 'undefined'
  );
}

function useHashRouting(): boolean {
  return canUseWindow() && window.location.protocol === 'file:';
}

function normalizePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '') return '/';
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const noTrailing =
    withSlash.length > 1 && withSlash.endsWith('/')
      ? withSlash.slice(0, -1)
      : withSlash;
  return noTrailing || '/';
}

function readLocationParts(): { path: string; search: string } {
  if (!canUseWindow()) return { path: '/', search: '' };
  if (useHashRouting()) {
    const hash = window.location.hash.replace(/^#/, '') || '/';
    const qIndex = hash.indexOf('?');
    if (qIndex >= 0) {
      return {
        path: normalizePath(hash.slice(0, qIndex)),
        search: hash.slice(qIndex),
      };
    }
    return { path: normalizePath(hash), search: '' };
  }
  return {
    path: normalizePath(window.location.pathname || '/'),
    search: window.location.search || '',
  };
}

function getSearchParam(search: string, key: string): string | null {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const value = params.get(key);
  return value && value.trim() ? value.trim() : null;
}

/** オープンリダイレクト防止: アプリ内パスのみ許可 */
export function sanitizeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  const trimmed = next.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (trimmed.includes('://')) return null;
  const pathOnly = normalizePath(trimmed.split('?')[0] ?? trimmed);
  if (pathOnly === '/login') return null;
  const route = parseAppRoute(pathOnly, '');
  if (route.name === 'login') return null;
  return pathOnly;
}

export function parseAppRoute(
  path?: string,
  search?: string,
): AppRoute {
  const parts =
    path == null
      ? readLocationParts()
      : { path: normalizePath(path), search: search ?? '' };
  const normalized = parts.path;

  if (normalized === '/login') {
    const next = sanitizeNextPath(getSearchParam(parts.search, 'next'));
    return next ? { name: 'login', next } : { name: 'login' };
  }
  if (normalized === '/admin') {
    return { name: 'admin' };
  }
  if (normalized === '/settings') {
    return { name: 'settings' };
  }
  const certSettingsMatch = normalized.match(/^\/certs\/([^/]+)\/settings$/);
  if (certSettingsMatch?.[1]) {
    return {
      name: 'settings',
      certificationId: decodeURIComponent(certSettingsMatch[1]),
    };
  }
  const certMatch = normalized.match(/^\/certs\/([^/]+)$/);
  if (certMatch?.[1]) {
    return { name: 'main', certificationId: decodeURIComponent(certMatch[1]) };
  }
  return { name: 'select' };
}

export function pathForRoute(route: AppRoute): string {
  switch (route.name) {
    case 'login': {
      if (route.next) {
        const safe = sanitizeNextPath(route.next);
        if (safe) {
          return `/login?next=${encodeURIComponent(safe)}`;
        }
      }
      return '/login';
    }
    case 'admin':
      return '/admin';
    case 'settings':
      return route.certificationId
        ? `/certs/${encodeURIComponent(route.certificationId)}/settings`
        : '/settings';
    case 'main':
      return `/certs/${encodeURIComponent(route.certificationId)}`;
    case 'select':
    default:
      return '/';
  }
}

function splitPathAndSearch(full: string): { path: string; search: string } {
  const qIndex = full.indexOf('?');
  if (qIndex >= 0) {
    return {
      path: normalizePath(full.slice(0, qIndex)),
      search: full.slice(qIndex),
    };
  }
  return { path: normalizePath(full), search: '' };
}

function writeFullPath(full: string, mode: 'push' | 'replace') {
  if (!canUseWindow()) return;
  const { path, search } = splitPathAndSearch(full);
  const nextFull = `${path}${search}`;

  if (useHashRouting()) {
    const nextHash = `#${nextFull}`;
    if (mode === 'replace') {
      const url = `${window.location.pathname}${window.location.search}${nextHash}`;
      window.history.replaceState(window.history.state, '', url);
    } else if (window.location.hash !== nextHash) {
      window.location.hash = nextFull;
    }
    return;
  }

  const current = `${normalizePath(window.location.pathname || '/')}${window.location.search || ''}`;
  if (current === nextFull && mode === 'push') return;
  if (mode === 'replace') {
    window.history.replaceState(window.history.state, '', nextFull);
  } else {
    window.history.pushState(window.history.state, '', nextFull);
  }
}

export function getAppRoute(): AppRoute {
  return parseAppRoute();
}

export function navigateAppRoute(
  route: AppRoute,
  mode: 'push' | 'replace' = 'push',
) {
  writeFullPath(pathForRoute(route), mode);
  listeners.forEach((listener) => listener());
}

export function subscribeAppRoute(listener: Listener): () => void {
  listeners.add(listener);
  if (!canUseWindow()) {
    return () => {
      listeners.delete(listener);
    };
  }

  const onChange = () => {
    listeners.forEach((l) => l());
  };

  window.addEventListener('popstate', onChange);
  window.addEventListener('hashchange', onChange);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', onChange);
    window.removeEventListener('hashchange', onChange);
  };
}
