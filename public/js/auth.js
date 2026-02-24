import { api, setToken, clearToken, isAuthenticated } from './api.js';

let currentUser = null;

export function getCurrentUser() {
  return currentUser;
}

export async function loadUser() {
  if (!isAuthenticated()) return null;
  try {
    const data = await api('/api/users/me');
    currentUser = data;
    return data;
  } catch {
    clearToken();
    currentUser = null;
    return null;
  }
}

export async function login(username, password) {
  const data = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(data.token);
  currentUser = data.user;
  return data;
}

export async function register(fields) {
  await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(fields),
  });
}

export function logout() {
  clearToken();
  currentUser = null;
  window.location.href = '/login.html';
}

export async function setTheme(theme) {
  await api('/api/users/me/theme', {
    method: 'PATCH',
    body: JSON.stringify({ theme_preference: theme }),
  });
  if (currentUser) currentUser.theme_preference = theme;
  document.documentElement.setAttribute('data-theme', theme);
}

export function applyStoredTheme() {
  const theme = currentUser?.theme_preference || localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
}

export function requireAuth() {
  if (!isAuthenticated()) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

export function requireAdmin() {
  if (!currentUser || currentUser.role !== 'Admin') {
    window.location.href = '/dashboard.html';
    return false;
  }
  return true;
}
