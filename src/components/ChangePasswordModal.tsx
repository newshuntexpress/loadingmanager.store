import React, { useState } from 'react';
import { AuthUser } from '../types';
import { ApiClient } from '../services/api';
import { Lock, KeyRound, Eye, EyeOff, Loader2, AlertCircle, LogOut, X, ShieldAlert } from 'lucide-react';

interface ChangePasswordModalProps {
  user: AuthUser;
  forced: boolean;
  onSuccess: (updatedUser: AuthUser) => void;
  onClose?: () => void;
  onLogout?: () => void;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({
  user,
  forced,
  onSuccess,
  onClose,
  onLogout,
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentPassword || !newPassword) {
      setError('Current password and new password are required.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }

    setLoading(true);
    try {
      const res = await ApiClient.changeOwnPassword(currentPassword, newPassword);
      onSuccess(res.user);
    } catch (err: any) {
      setError(err?.message || 'Unable to update password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/65 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-[#C2D0DF] w-full max-w-md overflow-hidden">
        <div className="bg-gradient-to-r from-[#1E2E3E] to-[#2B3E50] text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl">
              <KeyRound className="w-5 h-5 text-[#F0AB00]" />
            </div>
            <div>
              <h2 className="text-sm font-black tracking-wide">
                {forced ? 'Password Update Required' : 'Change Account Password'}
              </h2>
              <p className="text-[11px] text-[#CBD8E6]">
                Account: @{user.username} ({user.fullName})
              </p>
            </div>
          </div>
          {!forced && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#CBD8E6] hover:text-white hover:bg-white/10 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} data-preserve-case="true" className="p-5 space-y-4">
          {forced && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p>
                You signed in with a temporary password. Please set a permanent password before accessing the GatePass system.
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-xs font-semibold flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[#354A5F] mb-1">Current Password *</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#6A829C] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showPasswords ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={loading}
                className="w-full pl-9 pr-9 py-2 text-xs font-semibold rounded-xl border border-[#C2D0DF] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
              />
              <button
                type="button"
                onClick={() => setShowPasswords((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6A829C] hover:text-[#354A5F] p-1 cursor-pointer"
                tabIndex={-1}
              >
                {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#354A5F] mb-1">New Password *</label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
              disabled={loading}
              className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-[#C2D0DF] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
            />
            <p className="text-[10px] text-[#5B738B] mt-1">
              Minimum 8 characters, including uppercase, lowercase, number, and special character.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#354A5F] mb-1">Confirm New Password *</label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              disabled={loading}
              className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-[#C2D0DF] focus:outline-none focus:ring-2 focus:ring-[#0A6ED1]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-200">
            {forced && onLogout && (
              <button
                type="button"
                onClick={onLogout}
                disabled={loading}
                className="px-3 py-2 text-xs font-bold rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 flex items-center gap-1.5 cursor-pointer mr-auto"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            )}
            {!forced && onClose && (
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 text-xs font-bold rounded-xl border border-neutral-300 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 cursor-pointer"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-xs font-bold rounded-xl bg-[#0A6ED1] hover:bg-[#085CAF] disabled:opacity-60 text-white shadow flex items-center gap-1.5 cursor-pointer"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              <span>Update Password</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
