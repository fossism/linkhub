import React, { useState, useEffect } from 'react';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';

interface User {
  id: number;
  email: string;
}

export const App: React.FC = () => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('linkhub_token') || null);
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('linkhub_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [encryptionKey, setEncryptionKey] = useState<string | null>(() => sessionStorage.getItem('linkhub_ek') || null);
  
  // Pending URL shared from mobile devices
  const [, setSharedUrl] = useState<string | null>(null);

  // Parse share target parameters on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedText = params.get('text') || '';
    const sharedLink = params.get('url') || '';
    
    // Extract URL from shared text or link parameters
    let targetUrl = '';
    if (sharedLink) {
      targetUrl = sharedLink;
    } else if (sharedText) {
      const match = sharedText.match(/https?:\/\/[^\s]+/);
      if (match) targetUrl = match[0];
    }

    if (targetUrl) {
      setSharedUrl(targetUrl);
      // Clean up the URL search bar to avoid repeating imports on refresh
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleAuthSuccess = (newToken: string, newEncryptionKey: string, userData: User) => {
    localStorage.setItem('linkhub_token', newToken);
    localStorage.setItem('linkhub_user', JSON.stringify(userData));
    sessionStorage.setItem('linkhub_ek', newEncryptionKey);
    
    setToken(newToken);
    setUser(userData);
    setEncryptionKey(newEncryptionKey);
  };

  const handleLogout = () => {
    localStorage.removeItem('linkhub_token');
    localStorage.removeItem('linkhub_user');
    sessionStorage.removeItem('linkhub_ek');
    
    setToken(null);
    setUser(null);
    setEncryptionKey(null);
  };

  const API_URL = ((import.meta as any).env?.VITE_API_URL as string) || '';

  // If authenticated, render Dashboard
  if (token && encryptionKey && user) {
    return (
      <Dashboard
        token={token}
        encryptionKey={encryptionKey}
        user={user}
        onLogout={handleLogout}
        apiUrl={API_URL}
      />
    );
  }

  // Otherwise, render registration/login Auth panel
  return (
    <Auth
      onAuthSuccess={handleAuthSuccess}
      apiUrl={API_URL}
    />
  );
};

export default App;
