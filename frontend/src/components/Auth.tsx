import React, { useState } from 'react';
import { deriveKeys, bufferToHex } from '../crypto';
import { Shield, Mail, Lock, Loader2, ArrowRight } from 'lucide-react';

interface User {
  id: number;
  email: string;
  masterKeySalt?: string;
}

interface AuthProps {
  onAuthSuccess: (token: string, encryptionKey: string, user: User) => void;
  apiUrl: string;
}

export const Auth: React.FC<AuthProps> = ({ onAuthSuccess, apiUrl }) => {
  const [isLogin, setIsLogin] = useState<boolean>(true);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const generateRandomSalt = (): string => {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return bufferToHex(bytes);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!email || !password) {
      setError('Please fill in all fields.');
      setLoading(false);
      return;
    }

    if (!isLogin && password !== confirmPassword) {
      setError('Passwords do not match.');
      setLoading(false);
      return;
    }

    try {
      if (isLogin) {
        // --- LOGIN FLOW ---
        // 1. Fetch the cryptographic salt for this user email
        const saltRes = await fetch(`${apiUrl}/api/auth/salt?email=${encodeURIComponent(email)}`);
        if (!saltRes.ok) {
          throw new Error('Failed to retrieve authentication parameters.');
        }
        const { salt } = await saltRes.json();

        // 2. Derive keys locally using the salt
        const { encryptionKey, authKey } = await deriveKeys(password, salt);

        // 3. Authenticate with the server using the authKey
        const loginRes = await fetch(`${apiUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, passwordHash: authKey })
        });

        const data = await loginRes.json();
        if (!loginRes.ok) {
          throw new Error(data.error || 'Login failed.');
        }

        // 4. Save credentials and trigger success callback
        onAuthSuccess(data.token, encryptionKey, data.user);
      } else {
        // --- REGISTER FLOW ---
        // 1. Generate new cryptographically secure random salt
        const newSalt = generateRandomSalt();

        // 2. Derive keys locally
        const { encryptionKey, authKey } = await deriveKeys(password, newSalt);

        // 3. Register user on backend
        const regRes = await fetch(`${apiUrl}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            email, 
            passwordHash: authKey, 
            masterKeySalt: newSalt 
          })
        });

        const data = await regRes.json();
        if (!regRes.ok) {
          throw new Error(data.error || 'Registration failed.');
        }

        // 4. Save credentials and trigger success callback
        onAuthSuccess(data.token, encryptionKey, data.user);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-darkBg bg-grid-pattern relative px-4 overflow-hidden">
      {/* Background Glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 radial-glow-cyan pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 radial-glow-purple pointer-events-none"></div>

      <div className="w-full max-w-md animate-slide-in relative z-10">
        {/* Brand Banner */}
        <div className="flex flex-col items-center mb-8">
          <div className="p-4 bg-slate-900/60 rounded-2xl border border-cyan-500/30 shadow-neonCyan mb-4 animate-pulse-glow">
            <Shield className="h-10 w-10 text-accentBlue" />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-accentBlue via-accentIndigo to-neonPurple bg-clip-text text-transparent">
            LinkHub
          </h1>
          <p className="text-slateText text-sm mt-2 text-center max-w-xs">
            Zero-knowledge, self-hosted, AI-powered link indexing.
          </p>
        </div>

        {/* Card Panel */}
        <div className="glass-panel p-8 rounded-2xl shadow-glass border border-white/5">
          <div className="flex border-b border-white/5 pb-4 mb-6">
            <button
              onClick={() => { setIsLogin(true); setError(''); }}
              className={`flex-1 text-center font-semibold text-lg pb-2 transition-all ${isLogin ? 'text-accentBlue border-b-2 border-accentBlue' : 'text-slateText hover:text-white'}`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setIsLogin(false); setError(''); }}
              className={`flex-1 text-center font-semibold text-lg pb-2 transition-all ${!isLogin ? 'text-accentBlue border-b-2 border-accentBlue' : 'text-slateText hover:text-white'}`}
            >
              Create Account
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-950/40 border border-red-500/30 text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slateText mb-2">
                Email Address
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slateText">
                  <Mail className="h-5 w-5" />
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="cyber-input w-full pl-10 pr-4 py-3 rounded-xl text-white placeholder-slate-500 text-sm focus:border-accentBlue"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slateText mb-2">
                Master Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slateText">
                  <Lock className="h-5 w-5" />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="cyber-input w-full pl-10 pr-4 py-3 rounded-xl text-white placeholder-slate-500 text-sm focus:border-accentBlue"
                  required
                />
              </div>
              {!isLogin && (
                <p className="text-[10px] text-slateText mt-1.5 leading-relaxed">
                  ⚠️ This password derives your encryption key client-side. It is never sent to the server. If lost, your data cannot be decrypted.
                </p>
              )}
            </div>

            {!isLogin && (
              <div className="animate-slide-in">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slateText mb-2">
                  Confirm Password
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slateText">
                    <Lock className="h-5 w-5" />
                  </span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="cyber-input w-full pl-10 pr-4 py-3 rounded-xl text-white placeholder-slate-500 text-sm"
                    required={!isLogin}
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-accentBlue to-accentIndigo text-darkBg font-bold text-sm hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 disabled:pointer-events-none mt-2 shadow-neonCyan"
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  {isLogin ? 'Enter LinkHub' : 'Setup Lockbox'}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Auth;
