import React, { useEffect, useState } from 'react';
import { AuthUser, PublicBranding } from '../types';
import { ApiClient, ApiError } from '../services/api';
import {
  DEFAULT_ADMIN_EMAIL,
  isStaticNoBackendError,
  prewarmFirebaseAuthOriginCheck,
  signInWithGooglePopup,
  syncFirebaseUserProfileToFirestore,
} from '../firebase';
import {
  Building2,
  Lock,
  User as UserIcon,
  Mail,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  ShieldCheck,
  Truck,
  CheckCircle2,
} from 'lucide-react';

interface LoginViewProps {
  needsSetup: boolean;
  branding: PublicBranding | null;
  onAuthenticated: (user: AuthUser) => void;
  onOpenDriverStatus: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  needsSetup,
  branding,
  onAuthenticated,
  onOpenDriverStatus,
}) => {
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domainHint, setDomainHint] = useState<string | null>(null);

  const companyName = branding?.companyName?.trim() || 'MATERIAL LOADING & GATEPASS';
  const companySubtitle =
    branding?.companySubtitle?.trim() || 'Dispatch, Loading Slip & Gate Queue Management';
  const logoDataUrl = branding?.logoDataUrl || '';

  useEffect(() => {
    void prewarmFirebaseAuthOriginCheck();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDomainHint(null);

    const cleanUsername = username.trim();
    if (!cleanUsername) {
      setError('Please enter your username.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    if (needsSetup) {
      if (fullName.trim().length < 2) {
        setError('Full Name is required (minimum 2 characters).');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setLoading(true);
    try {
      if (needsSetup) {
        const res = await ApiClient.setupInitialAdmin({
          username: cleanUsername,
          fullName: fullName.trim(),
          email: email.trim() || undefined,
          password,
        });
        onAuthenticated(res.user);
      } else {
        const res = await ApiClient.login(cleanUsername, password);
        onAuthenticated(res.user);
      }
    } catch (err: any) {
      if (isStaticNoBackendError(err)) {
        setError(
          'Static hosting detected (no Node.js /api server). Please sign in using "Continue with Google (Firebase)" below.'
        );
      } else {
        setError(err?.message || 'Unable to sign in. Please verify your credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFirebaseGoogleLogin = async () => {
    setError(null);
    setDomainHint(null);
    setGoogleLoading(true);
    try {
      const { user: fbUser, idToken } = await signInWithGooglePopup();
      const res = await ApiClient.loginWithFirebase(idToken);
      // Sync profile & admin marker to Firestore without blocking successful portal sign-in
      try {
        await syncFirebaseUserProfileToFirestore(fbUser, res.user.roleName || 'user');
      } catch {
        // Firestore profile sync is best-effort for non-admin users if rules don't allow client creation
      }
      onAuthenticated(res.user);
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/unauthorized-domain') {
        const host = typeof window !== 'undefined' ? window.location.hostname : '';
        setDomainHint(host || null);
        setError(
          `Firebase Google Sign-In blocked for domain "${host || 'current host'}". Add this domain in Firebase Console → Authentication → Settings → Authorized domains, or sign in with your Username & Password.`
        );
      } else if (code === 'auth/popup-closed-by-user') {
        setError('Google sign-in popup was closed before completing login.');
      } else if (code === 'auth/popup-blocked') {
        setError('Browser blocked the Google sign-in popup. Please allow popups for this site and try again.');
      } else if (code === 'auth/web-storage-unsupported') {
        setError(
          'Browser storage is restricted inside this embedded frame for Google Sign-In. Open the app in a full browser tab or sign in with your Username & Password.'
        );
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err?.message || 'Firebase Google Sign-In failed. Please try again.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#EEF3F8] via-[#E2EBF4] to-[#D6E3F0] flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-[0_18px_45px_-12px_rgba(24,42,64,0.28)] border border-[#C2D0DF] overflow-hidden">
        {/* Enterprise Brand Header */}
        <div className="bg-gradient-to-r from-[#1E2E3E] via-[#2B3E50] to-[#1D4872] text-white px-6 py-5 border-b border-[#142230]">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shrink-0 overflow-hidden ring-2 ring-[#F0AB00]/80 p-1 shadow">
              {logoDataUrl ? (
                <img src={logoDataUrl} alt={companyName} className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full rounded-lg bg-gradient-to-br from-[#0A6ED1] to-[#004A99] flex items-center justify-center text-[#F0AB00]">
                  <Building2 className="w-6 h-6" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-base font-black tracking-wide truncate text-white">{companyName}</h1>
              </div>
              <p className="text-[11px] text-[#CBD8E6] truncate mt-0.5">{companySubtitle}</p>
              <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#162432]/80 border border-[#4A6580]/60 text-[10px] font-bold text-[#F0AB00]">
                <ShieldCheck className="w-3 h-3 shrink-0" />
                <span>{needsSetup ? 'Initial Administrator Setup' : 'Authorized Personnel Sign In'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-4">
          {needsSetup && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Welcome! Create the first Administrator account.</p>
                <p className="text-[11px] text-blue-800 mt-0.5">
                  Or initialize instantly with Google ({DEFAULT_ADMIN_EMAIL}) below.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-3.5 py-2.5 text-xs font-semibold flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p>{error}</p>
                {domainHint && (
                  <p className="text-[11px] font-mono bg-white/80 border border-red-200 rounded px-2 py-1 text-red-900 break-all">
                    Domain to authorize: {domainHint}
                  </p>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} data-preserve-case="true" className="space-y-3.5">
            {needsSetup && (
              <div>
                <label className="block text-xs font-bold text-[#354A5F] mb-1">Full Name *</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Plant Administrator"
                  required
                  disabled={loading || googleLoading}
                  className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-[#C2D0DF] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1] bg-[#F8FAFC]"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-[#354A5F] mb-1">Username *</label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-[#6A829C] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="Enter your username"
                  required
                  disabled={loading || googleLoading}
                  className="w-full pl-9 pr-3 py-2 text-xs font-semibold rounded-xl border border-[#C2D0DF] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1] bg-[#F8FAFC]"
                />
              </div>
            </div>

            {needsSetup && (
              <div>
                <label className="block text-xs font-bold text-[#354A5F] mb-1">
                  Admin Email (Optional)
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#6A829C] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={DEFAULT_ADMIN_EMAIL}
                    disabled={loading || googleLoading}
                    className="w-full pl-9 pr-3 py-2 text-xs font-semibold rounded-xl border border-[#C2D0DF] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1] bg-[#F8FAFC]"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-[#354A5F] mb-1">Password *</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#6A829C] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={needsSetup ? 'new-password' : 'current-password'}
                  placeholder={needsSetup ? 'Create a strong password' : 'Enter your password'}
                  required
                  disabled={loading || googleLoading}
                  className="w-full pl-9 pr-9 py-2 text-xs font-semibold rounded-xl border border-[#C2D0DF] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1] bg-[#F8FAFC]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6A829C] hover:text-[#354A5F] p-1 cursor-pointer"
                  tabIndex={-1}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {needsSetup && (
              <div>
                <label className="block text-xs font-bold text-[#354A5F] mb-1">Confirm Password *</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Re-enter password"
                  required
                  disabled={loading || googleLoading}
                  className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-[#C2D0DF] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1] bg-[#F8FAFC]"
                />
                <p className="text-[10px] text-[#5B738B] mt-1">
                  Min 8 chars with uppercase, lowercase, number, and special character.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="w-full py-2.5 px-4 bg-gradient-to-b from-[#0A6ED1] to-[#085CAF] hover:from-[#0B79E6] hover:to-[#0964BE] disabled:opacity-60 text-white font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-2 cursor-pointer transition active:scale-[0.99]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{needsSetup ? 'Creating Admin Account...' : 'Signing In...'}</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-[#F0AB00]" />
                  <span>{needsSetup ? 'Initialize Admin & Sign In' : 'Sign In to System'}</span>
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-[#DCE5EE]" />
            <span className="shrink mx-3 text-[10px] font-bold uppercase tracking-wider text-[#7A8FA6]">
              Or Firebase Auth
            </span>
            <div className="flex-grow border-t border-[#DCE5EE]" />
          </div>

          {/* Firebase Google Sign-In */}
          <button
            type="button"
            onClick={handleFirebaseGoogleLogin}
            disabled={loading || googleLoading}
            className="w-full py-2.5 px-4 bg-white hover:bg-[#F4F7FA] disabled:opacity-60 text-[#1C2833] font-bold text-xs rounded-xl border border-[#C2D0DF] shadow-sm flex items-center justify-center gap-2.5 cursor-pointer transition"
          >
            {googleLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#0A6ED1]" />
                <span>Verifying Google Account...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
                  />
                </svg>
                <span>{needsSetup ? 'Initialize Admin with Google (Firebase)' : 'Continue with Google (Firebase)'}</span>
              </>
            )}
          </button>

          {!needsSetup && (
            <p className="text-[11px] text-center text-[#5B738B] leading-relaxed">
              Google Sign-In is restricted to users authorized by the Administrator (
              <span className="font-mono font-semibold text-[#354A5F]">{DEFAULT_ADMIN_EMAIL}</span>).
            </p>
          )}

          {/* Public Driver Live Status Link */}
          <div className="pt-2 border-t border-[#E6EDF4]">
            <button
              type="button"
              onClick={onOpenDriverStatus}
              className="w-full py-2 px-3 bg-[#F4F7FA] hover:bg-[#E7EEF5] text-[#354A5F] font-bold text-xs rounded-xl border border-[#CBD8E6] flex items-center justify-center gap-2 cursor-pointer transition"
            >
              <Truck className="w-4 h-4 text-[#0A6ED1]" />
              <span>Driver Live Loading Status (No Login Required)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
