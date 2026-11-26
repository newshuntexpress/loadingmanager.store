import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActiveSessionInfo,
  AuditLogEntry,
  AuthUser,
  PermissionOption,
  PlantConfig,
  RoleOption,
  UserRoleName,
} from '../types';
import { ApiClient, isStaticFirebaseOnlyMode } from '../services/api';
import { DEFAULT_PLANTS } from '../services/storage';
import { processSignatureFile } from '../utils/logo';
import {
  auth,
  DEFAULT_ADMIN_EMAIL,
  deleteAuthorizedUserFromFirestore,
  syncAuthorizedUserToFirestore,
} from '../firebase';
import {
  Shield,
  Users,
  History,
  Activity,
  Plus,
  Edit2,
  Trash2,
  KeyRound,
  LogOut,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Search,
  Lock,
  Unlock,
  Upload,
  PenTool,
  Sliders,
  MapPin,
} from 'lucide-react';

interface AdminDashboardModalProps {
  currentUser: AuthUser;
  plants?: PlantConfig[];
  onClose: () => void;
  onUsersUpdated?: () => void;
}

type AdminTab = 'users' | 'audit' | 'sessions';

interface SectionPreset {
  id: string;
  label: string;
  description: string;
  roleName: UserRoleName;
  permissions: string[];
}

const SECTION_PRESETS: SectionPreset[] = [
  {
    id: 'liquid_only',
    label: 'Liquid Store Only',
    description: 'Access strictly to Liquid Material Camp Store',
    roleName: 'liquid_store_operator',
    permissions: ['liquid.view', 'liquid.store', 'liquid.materials'],
  },
  {
    id: 'forklift_only',
    label: 'Forklift Loading Only',
    description: 'Access strictly to Forklift Loading checklists',
    roleName: 'forklift_operator',
    permissions: ['tickets.view', 'forklift.operate'],
  },
  {
    id: 'guard_only',
    label: 'Security Guard Only',
    description: 'Access strictly to Security Guard Gate Checkpost',
    roleName: 'security_guard',
    permissions: ['guard.view'],
  },
  {
    id: 'exfactory_only',
    label: 'Ex-Factory Only',
    description: 'Access strictly to Ex-Factory Dispatch',
    roleName: 'ex_factory_operator',
    permissions: ['ex_factory.view', 'ex_factory.create', 'ex_factory.update'],
  },
  {
    id: 'dispatch_operator',
    label: 'Dispatch & Gate Desk',
    description: 'Tickets, Slips, Dispatch Details, Material Register & Drivers',
    roleName: 'user',
    permissions: [
      'tickets.view',
      'tickets.create',
      'tickets.update',
      'guard.view',
      'slips.print',
      'drivers.manage',
      'materials.view',
      'materials.manage',
      'reports.view',
      'dispatch.view',
      'material_register.view',
    ],
  },
];

export const AdminDashboardModal: React.FC<AdminDashboardModalProps> = ({
  currentUser,
  plants = DEFAULT_PLANTS,
  onClose,
  onUsersUpdated,
}) => {
  const plantOptions = plants && plants.length > 0 ? plants : DEFAULT_PLANTS;
  const [staticMode, setStaticMode] = useState<boolean>(() => isStaticFirebaseOnlyMode());
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [permissions, setPermissions] = useState<PermissionOption[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [sessions, setSessions] = useState<ActiveSessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create User Form State
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newTempPassword, setNewTempPassword] = useState('');
  const [newRequirePwChange, setNewRequirePwChange] = useState(true);
  const [newRoleName, setNewRoleName] = useState<UserRoleName>('user');
  const [newSelectedPerms, setNewSelectedPerms] = useState<string[]>([
    'tickets.view',
    'tickets.create',
    'tickets.update',
    'guard.view',
    'slips.print',
    'drivers.manage',
    'materials.view',
    'reports.view',
    'dispatch.view',
    'material_register.view',
  ]);
  const [newAllowedPlants, setNewAllowedPlants] = useState<string[]>(['RIYADH']);
  const [newDefaultPlantId, setNewDefaultPlantId] = useState<string>('RIYADH');
  const [newSignatureDataUrl, setNewSignatureDataUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const createSigRef = useRef<HTMLInputElement>(null);

  // Edit / Permissions / Reset Password Modal States
  const [editingUser, setEditingUser] = useState<AuthUser | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRoleName, setEditRoleName] = useState<UserRoleName>('user');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editAllowedPlants, setEditAllowedPlants] = useState<string[]>(['RIYADH']);
  const [editDefaultPlantId, setEditDefaultPlantId] = useState<string>('RIYADH');
  const [editSignatureDataUrl, setEditSignatureDataUrl] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const editSigRef = useRef<HTMLInputElement>(null);

  const [permTargetUser, setPermTargetUser] = useState<AuthUser | null>(null);
  const [permSelection, setPermSelection] = useState<string[]>([]);
  const [savingPerms, setSavingPerms] = useState(false);

  const [resetTargetUser, setResetTargetUser] = useState<AuthUser | null>(null);
  const [resetTempPass, setResetTempPass] = useState('');
  const [savingReset, setSavingReset] = useState(false);

  const [confirmDeleteUser, setConfirmDeleteUser] = useState<AuthUser | null>(null);
  const [auditSearch, setAuditSearch] = useState('');

  const showToast = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 5000);
  };

  const togglePlantInList = (currentList: string[], plantId: string): string[] => {
    if (plantId === 'ALL') {
      return currentList.includes('ALL') ? [plantOptions[0]?.id || 'RIYADH'] : ['ALL'];
    }
    const withoutAll = currentList.filter((p) => p !== 'ALL');
    if (withoutAll.includes(plantId)) {
      const next = withoutAll.filter((p) => p !== plantId);
      return next.length > 0 ? next : [plantId];
    }
    return [...withoutAll, plantId];
  };

  const resolveDefaultPlantForList = (allowed: string[], currentDef: string): string => {
    if (allowed.includes('ALL')) {
      return currentDef || plantOptions[0]?.id || 'RIYADH';
    }
    if (allowed.includes(currentDef)) return currentDef;
    return allowed[0] || plantOptions[0]?.id || 'RIYADH';
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, rolesRes, logsRes, sessRes] = await Promise.all([
        ApiClient.getUsers(),
        ApiClient.getRolesAndPermissions(),
        ApiClient.getAuditLogs({ limit: 150 }).catch(() => ({ logs: [] })),
        ApiClient.getActiveSessions().catch(() => ({ sessions: [] })),
      ]);
      const loadedUsers = usersRes.users || [];
      setUsers(loadedUsers);
      setRoles(rolesRes.roles || []);
      setPermissions(rolesRes.permissions || []);
      setAuditLogs(logsRes.logs || []);
      setSessions(sessRes.sessions || []);

      // Mirror SQLite users to Firestore allowlist whenever signed into Firebase
      if (!isStaticFirebaseOnlyMode() && auth.currentUser?.emailVerified && loadedUsers.length > 0) {
        void Promise.all(
          loadedUsers.map((u) =>
            syncAuthorizedUserToFirestore(
              {
                id: u.id,
                username: u.username,
                fullName: u.fullName,
                email: u.email,
                roleName: u.roleName,
                isActive: u.isActive,
                permissions: u.permissions,
                allowedPlants: u.allowedPlants,
                defaultPlantId: u.defaultPlantId,
                signatureDataUrl: u.signatureDataUrl,
              },
              currentUser.email || currentUser.username
            ).catch(() => {})
          )
        );
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to load user & security data.');
    } finally {
      setStaticMode(isStaticFirebaseOnlyMode());
      setLoading(false);
    }
  }, [currentUser.email, currentUser.username]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const getAllowedPermissionsForRole = (roleName: string): PermissionOption[] => {
    if (roleName === 'admin') return permissions;
    if (roleName === 'forklift_operator') {
      return permissions.filter((p) => p.key === 'tickets.view' || p.key === 'forklift.operate');
    }
    if (roleName === 'liquid_store_operator') {
      return permissions.filter(
        (p) => p.key === 'liquid.view' || p.key === 'liquid.store' || p.key === 'liquid.materials'
      );
    }
    if (roleName === 'ex_factory_operator') {
      return permissions.filter((p) => p.key.startsWith('ex_factory.'));
    }
    if (roleName === 'security_guard') {
      return permissions.filter((p) => p.key === 'guard.view');
    }
    if (roleName === 'view_only') {
      const allowed = new Set([
        'tickets.view',
        'guard.view',
        'materials.view',
        'dispatch.view',
        'material_register.view',
        'reports.view',
        'liquid.view',
        'ex_factory.view',
      ]);
      return permissions.filter((p) => allowed.has(p.key));
    }
    const adminOnly = new Set(['users.manage', 'audit.view', 'settings.manage']);
    return permissions.filter((p) => !adminOnly.has(p.key));
  };

  const applySectionPreset = (preset: SectionPreset) => {
    setNewRoleName(preset.roleName);
    setNewSelectedPerms([...preset.permissions]);
  };

  const handleRoleChangeInCreate = (role: UserRoleName) => {
    setNewRoleName(role);
    if (role === 'liquid_store_operator') {
      setNewSelectedPerms(['liquid.view', 'liquid.store', 'liquid.materials']);
    } else if (role === 'forklift_operator') {
      setNewSelectedPerms(['tickets.view', 'forklift.operate']);
    } else if (role === 'security_guard') {
      setNewSelectedPerms(['guard.view']);
    } else if (role === 'ex_factory_operator') {
      setNewSelectedPerms(['ex_factory.view', 'ex_factory.create', 'ex_factory.update']);
    } else if (role === 'view_only') {
      setNewSelectedPerms([
        'tickets.view',
        'guard.view',
        'materials.view',
        'dispatch.view',
        'material_register.view',
        'reports.view',
        'liquid.view',
        'ex_factory.view',
      ]);
    } else if (role === 'admin') {
      setNewSelectedPerms(permissions.map((p) => p.key));
    } else {
      setNewSelectedPerms([
        'tickets.view',
        'tickets.create',
        'tickets.update',
        'guard.view',
        'slips.print',
        'drivers.manage',
        'materials.view',
        'materials.manage',
        'reports.view',
        'dispatch.view',
        'material_register.view',
      ]);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const effectivePlants = newRoleName === 'admin' ? ['ALL'] : newAllowedPlants;
      const effectiveDefault = resolveDefaultPlantForList(effectivePlants, newDefaultPlantId);
      const res = await ApiClient.createUser({
        username: newUsername.trim(),
        fullName: newFullName.trim(),
        email: newEmail.trim() || undefined,
        temporaryPassword: newTempPassword || undefined,
        requirePasswordChange: newRequirePwChange,
        roleName: newRoleName,
        isActive: true,
        permissions: newRoleName === 'admin' ? undefined : newSelectedPerms,
        allowedPlants: effectivePlants,
        defaultPlantId: effectiveDefault,
        signatureDataUrl: newSignatureDataUrl || undefined,
      });

      if (!isStaticFirebaseOnlyMode()) {
        await syncAuthorizedUserToFirestore(
          {
            id: res.user.id,
            username: res.user.username,
            fullName: res.user.fullName,
            email: res.user.email,
            roleName: res.user.roleName,
            isActive: res.user.isActive,
            permissions: res.user.permissions,
            allowedPlants: res.user.allowedPlants,
            defaultPlantId: res.user.defaultPlantId,
            signatureDataUrl: res.user.signatureDataUrl,
          },
          currentUser.email || currentUser.username
        ).catch(() => {});
      }

      setNewUsername('');
      setNewFullName('');
      setNewEmail('');
      setNewTempPassword('');
      setNewSignatureDataUrl('');
      setNewAllowedPlants(['RIYADH']);
      setNewDefaultPlantId('RIYADH');
      setShowCreateForm(false);
      showToast('success', `User "@${res.user.username}" created with "${res.user.roleDisplayName}" access.`);
      await loadAll();
      onUsersUpdated?.();
    } catch (err: any) {
      setStaticMode(isStaticFirebaseOnlyMode());
      showToast('error', err?.message || 'Unable to create user.');
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (u: AuthUser) => {
    const initialPlants =
      u.roleName === 'admin'
        ? ['ALL']
        : Array.isArray(u.allowedPlants) && u.allowedPlants.length > 0
        ? u.allowedPlants
        : ['RIYADH'];
    setEditingUser(u);
    setEditFullName(u.fullName);
    setEditEmail(u.email || '');
    setEditRoleName((u.roleName as UserRoleName) || 'user');
    setEditIsActive(u.isActive);
    setEditAllowedPlants(initialPlants);
    setEditDefaultPlantId(resolveDefaultPlantForList(initialPlants, u.defaultPlantId || 'RIYADH'));
    setEditSignatureDataUrl(u.signatureDataUrl || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSavingEdit(true);
    try {
      const effectivePlants = editRoleName === 'admin' ? ['ALL'] : editAllowedPlants;
      const effectiveDefault = resolveDefaultPlantForList(effectivePlants, editDefaultPlantId);
      const res = await ApiClient.updateUser(editingUser.id, {
        fullName: editFullName.trim(),
        email: editEmail.trim(),
        roleName: editRoleName,
        isActive: editIsActive,
        allowedPlants: effectivePlants,
        defaultPlantId: effectiveDefault,
        signatureDataUrl: editSignatureDataUrl,
      });
      if (!isStaticFirebaseOnlyMode()) {
        await syncAuthorizedUserToFirestore(
          {
            id: res.user.id,
            username: res.user.username,
            fullName: res.user.fullName,
            email: res.user.email,
            roleName: res.user.roleName,
            isActive: res.user.isActive,
            permissions: res.user.permissions,
            allowedPlants: res.user.allowedPlants,
            defaultPlantId: res.user.defaultPlantId,
            signatureDataUrl: res.user.signatureDataUrl,
          },
          currentUser.email || currentUser.username,
          editingUser.email
        ).catch(() => {});
      }
      setEditingUser(null);
      showToast('success', `Updated "@${res.user.username}" successfully.`);
      await loadAll();
      onUsersUpdated?.();
    } catch (err: any) {
      showToast('error', err?.message || 'Unable to update user.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSavePermissions = async () => {
    if (!permTargetUser) return;
    setSavingPerms(true);
    try {
      const res = await ApiClient.updateUserPermissions(permTargetUser.id, permSelection);
      if (!isStaticFirebaseOnlyMode() && res?.user) {
        await syncAuthorizedUserToFirestore(
          {
            id: res.user.id,
            username: res.user.username,
            fullName: res.user.fullName,
            email: res.user.email,
            roleName: res.user.roleName,
            isActive: res.user.isActive,
            permissions: res.user.permissions,
            allowedPlants: res.user.allowedPlants,
            defaultPlantId: res.user.defaultPlantId,
            signatureDataUrl: res.user.signatureDataUrl,
          },
          currentUser.email || currentUser.username,
          res.user.email
        ).catch(() => {});
      }
      setPermTargetUser(null);
      showToast('success', `Section permissions updated for "@${permTargetUser.username}".`);
      await loadAll();
      onUsersUpdated?.();
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to update permissions.');
    } finally {
      setSavingPerms(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTargetUser) return;
    setSavingReset(true);
    try {
      await ApiClient.resetUserPassword(resetTargetUser.id, resetTempPass);
      setResetTargetUser(null);
      setResetTempPass('');
      showToast('success', `Temporary password reset for "@${resetTargetUser.username}".`);
      await loadAll();
    } catch (err: any) {
      showToast('error', err?.message || 'Unable to reset password.');
    } finally {
      setSavingReset(false);
    }
  };

  const handleRevokeSessions = async (u: AuthUser) => {
    try {
      await ApiClient.revokeUserSessions(u.id);
      showToast('success', `Signed out all active sessions for "@${u.username}".`);
      await loadAll();
    } catch (err: any) {
      showToast('error', err?.message || 'Unable to revoke sessions.');
    }
  };

  const handleDeleteUser = async (u: AuthUser) => {
    try {
      await ApiClient.deleteUser(u.id);
      if (!isStaticFirebaseOnlyMode()) {
        await deleteAuthorizedUserFromFirestore(u.id, u.email).catch(() => {});
      }
      setConfirmDeleteUser(null);
      showToast('success', `Deleted user "@${u.username}".`);
      await loadAll();
      onUsersUpdated?.();
    } catch (err: any) {
      showToast('error', err?.message || 'Unable to delete user.');
    }
  };

  const filteredLogs = auditLogs.filter((l) => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      (l.actorUsername || '').toLowerCase().includes(q) ||
      l.action.toLowerCase().includes(q) ||
      (l.details || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/65 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-[#C2D0DF] w-full max-w-5xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#1E2E3E] via-[#2B3E50] to-[#1A4369] text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl border border-white/15">
              <Shield className="w-5 h-5 text-[#F0AB00]" />
            </div>
            <div>
              <h2 className="text-base font-black tracking-wide">
                Administrator Security &amp; User Management
              </h2>
              <p className="text-[11px] text-[#CBD8E6]">
                Authorized Users, Firebase Email Whitelist, Section Allotment &amp; Audit Logs
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#CBD8E6] hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub-Nav Tabs */}
        <div className="bg-[#F4F7FA] border-b border-[#DCE5EE] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('users')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition ${
                activeTab === 'users'
                  ? 'bg-[#0A6ED1] text-white shadow-sm'
                  : 'bg-white text-[#354A5F] border border-[#C2D0DF] hover:bg-[#EAF1F8]'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Users &amp; Section Access ({users.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition ${
                activeTab === 'audit'
                  ? 'bg-[#0A6ED1] text-white shadow-sm'
                  : 'bg-white text-[#354A5F] border border-[#C2D0DF] hover:bg-[#EAF1F8]'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Audit Logs ({auditLogs.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sessions')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition ${
                activeTab === 'sessions'
                  ? 'bg-[#0A6ED1] text-white shadow-sm'
                  : 'bg-white text-[#354A5F] border border-[#C2D0DF] hover:bg-[#EAF1F8]'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Active Sessions ({sessions.length})</span>
            </button>
          </div>

          {activeTab === 'users' && (
            <button
              type="button"
              onClick={() => setShowCreateForm((v) => !v)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#107E3E] hover:bg-[#0D6B34] text-white shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showCreateForm ? 'Close Create Form' : 'Create New User'}</span>
            </button>
          )}
        </div>

        {/* Feedback Banner */}
        {feedback && (
          <div
            className={`mx-4 mt-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold border flex items-center gap-2 shrink-0 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-red-50 text-red-800 border-red-200'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-[#5B738B]">
              <Loader2 className="w-7 h-7 animate-spin text-[#0A6ED1]" />
              <span className="text-xs font-bold">Loading users and security records...</span>
            </div>
          ) : activeTab === 'users' ? (
            <>
              {showCreateForm && (
                <form
                  onSubmit={handleCreateUser}
                  data-preserve-case="true"
                  className="bg-[#F8FAFC] border border-[#C2D0DF] rounded-2xl p-4 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCE5EE] pb-2.5">
                    <div>
                      <h3 className="text-sm font-black text-[#1C2833]">Create &amp; Authorize New User</h3>
                      <p className="text-[11px] text-[#5B738B]">
                        Assign Google Email (for Firebase Login), Temporary Password, and specific section access.
                      </p>
                    </div>
                  </div>

                  {/* Quick 1-Click Section Allotment Presets */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#354A5F] block">
                      Quick Section Allotment Presets:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {SECTION_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => applySectionPreset(preset)}
                          title={preset.description}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer transition ${
                            newRoleName === preset.roleName
                              ? 'bg-[#0A6ED1] text-white border-[#085CAF]'
                              : 'bg-white text-[#354A5F] border-[#C2D0DF] hover:bg-[#EAF1F8]'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-[#354A5F] mb-1">Username *</label>
                      <input
                        type="text"
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        placeholder="e.g. liquid.op1"
                        required
                        className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#C2D0DF] bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#354A5F] mb-1">Full Name *</label>
                      <input
                        type="text"
                        value={newFullName}
                        onChange={(e) => setNewFullName(e.target.value)}
                        placeholder="e.g. Ramesh Kumar"
                        required
                        className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#C2D0DF] bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#354A5F] mb-1">
                        Google / Work Email (Firebase Login) {staticMode ? '*' : ''}
                      </label>
                      <input
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="user@gmail.com"
                        required={staticMode}
                        className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#C2D0DF] bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#354A5F] mb-1">
                        Temporary Password {staticMode ? '(Optional in Firebase mode)' : newEmail.trim() ? '(Optional)' : '*'}
                      </label>
                      <input
                        type="text"
                        value={newTempPassword}
                        onChange={(e) => setNewTempPassword(e.target.value)}
                        placeholder="e.g. Gate@2026!"
                        className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#C2D0DF] bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#354A5F] mb-1">Role / Section *</label>
                      <select
                        value={newRoleName}
                        onChange={(e) => handleRoleChangeInCreate(e.target.value as UserRoleName)}
                        className="w-full px-3 py-1.5 text-xs font-bold rounded-lg border border-[#C2D0DF] bg-white"
                      >
                        {roles.map((r) => (
                          <option key={r.id} value={r.name}>
                            {r.displayName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2 text-xs font-semibold text-[#354A5F] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newRequirePwChange}
                          onChange={(e) => setNewRequirePwChange(e.target.checked)}
                          className="w-4 h-4 rounded border-[#C2D0DF] text-[#0A6ED1]"
                        />
                        <span>Require password change on first login</span>
                      </label>
                    </div>
                  </div>

                  {/* Plant Access Authorization */}
                  <div className="bg-white border border-[#DCE5EE] rounded-xl p-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-extrabold text-[#1C2833] flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-[#0A6ED1]" />
                        <span>Authorized Plants (Riyadh, Jeddah &amp; Multi-Plant Access)</span>
                      </span>
                      {newRoleName === 'admin' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Administrators automatically access All Plants
                        </span>
                      )}
                    </div>
                    {newRoleName !== 'admin' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                        <div className="flex flex-wrap gap-2">
                          <label
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer ${
                              newAllowedPlants.includes('ALL')
                                ? 'bg-indigo-50 text-indigo-800 border-indigo-300'
                                : 'bg-slate-50 text-[#354A5F] border-slate-200'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={newAllowedPlants.includes('ALL')}
                              onChange={() => {
                                const next = togglePlantInList(newAllowedPlants, 'ALL');
                                setNewAllowedPlants(next);
                                setNewDefaultPlantId(resolveDefaultPlantForList(next, newDefaultPlantId));
                              }}
                              className="rounded text-[#0A6ED1]"
                            />
                            <span>All Plants</span>
                          </label>
                          {plantOptions.map((pl) => {
                            const checked = !newAllowedPlants.includes('ALL') && newAllowedPlants.includes(pl.id);
                            return (
                              <label
                                key={pl.id}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer ${
                                  checked
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                    : 'bg-slate-50 text-[#354A5F] border-slate-200'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const next = togglePlantInList(newAllowedPlants, pl.id);
                                    setNewAllowedPlants(next);
                                    setNewDefaultPlantId(resolveDefaultPlantForList(next, newDefaultPlantId));
                                  }}
                                  className="rounded text-[#0A6ED1]"
                                />
                                <span>
                                  {pl.name} ({pl.id})
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-[#354A5F] mb-1">
                            Default Plant on Login
                          </label>
                          <select
                            value={newDefaultPlantId}
                            onChange={(e) => setNewDefaultPlantId(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs font-bold rounded-lg border border-[#C2D0DF] bg-white"
                          >
                            {(newAllowedPlants.includes('ALL')
                              ? plantOptions
                              : plantOptions.filter((pl) => newAllowedPlants.includes(pl.id))
                            ).map((pl) => (
                              <option key={pl.id} value={pl.id}>
                                {pl.name} ({pl.id})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Signature Upload */}
                  <div className="flex flex-wrap items-center gap-3 bg-white border border-[#DCE5EE] rounded-xl p-2.5">
                    <PenTool className="w-4 h-4 text-[#0A6ED1]" />
                    <span className="text-xs font-bold text-[#354A5F]">Digital Signature (Optional):</span>
                    <input
                      ref={createSigRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        try {
                          const dataUrl = await processSignatureFile(file);
                          setNewSignatureDataUrl(dataUrl);
                        } catch (err: any) {
                          showToast('error', err?.message || 'Invalid signature image.');
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => createSigRef.current?.click()}
                      className="px-2.5 py-1 rounded-lg bg-[#EAF1F8] hover:bg-[#DCE7F3] text-[#0A6ED1] text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{newSignatureDataUrl ? 'Change Signature' : 'Upload Signature'}</span>
                    </button>
                    {newSignatureDataUrl && (
                      <>
                        <img src={newSignatureDataUrl} alt="Signature" className="h-7 object-contain border rounded px-1" />
                        <button
                          type="button"
                          onClick={() => setNewSignatureDataUrl('')}
                          className="text-xs text-red-600 font-bold cursor-pointer"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>

                  {/* Section & Permission Matrix */}
                  {newRoleName !== 'admin' && (
                    <div className="bg-white border border-[#DCE5EE] rounded-xl p-3 space-y-2">
                      <span className="text-xs font-extrabold text-[#1C2833] block">
                        Allotted Section Permissions ({newSelectedPerms.length} selected)
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {getAllowedPermissionsForRole(newRoleName).map((perm) => {
                          const checked = newSelectedPerms.includes(perm.key);
                          return (
                            <label
                              key={perm.id}
                              className={`flex items-start gap-2 p-2 rounded-lg border text-xs cursor-pointer ${
                                checked ? 'bg-blue-50/70 border-blue-200' : 'bg-slate-50/60 border-slate-200'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setNewSelectedPerms((prev) => [...prev, perm.key]);
                                  } else {
                                    setNewSelectedPerms((prev) => prev.filter((k) => k !== perm.key));
                                  }
                                }}
                                className="mt-0.5 rounded text-[#0A6ED1]"
                              />
                              <div>
                                <span className="font-bold text-[#1C2833] block leading-tight">{perm.name}</span>
                                <span className="text-[10px] font-mono text-[#5B738B]">{perm.key}</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateForm(false)}
                      className="px-3.5 py-2 text-xs font-bold rounded-xl border border-neutral-300 bg-white hover:bg-neutral-100 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={creating}
                      className="px-4 py-2 text-xs font-bold rounded-xl bg-[#107E3E] hover:bg-[#0D6B34] disabled:opacity-60 text-white shadow flex items-center gap-1.5 cursor-pointer"
                    >
                      {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      <span>Create User</span>
                    </button>
                  </div>
                </form>
              )}

              {/* Users List */}
              <div className="space-y-2.5">
                {users.map((u) => {
                  const isDefaultAdmin = u.email?.trim().toLowerCase() === DEFAULT_ADMIN_EMAIL;
                  const isSelf = u.id === currentUser.id;
                  return (
                    <div
                      key={u.id}
                      className={`border rounded-xl p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
                        u.isActive ? 'bg-white border-[#C2D0DF]' : 'bg-red-50/40 border-red-200'
                      }`}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-black text-[#1C2833]">@{u.username}</span>
                          <span className="text-xs font-bold text-[#354A5F]">{u.fullName}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#EAF1F8] text-[#0A6ED1] border border-[#C2D0DF]">
                            {u.roleDisplayName}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${
                              u.isActive
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-red-100 text-red-700 border-red-200'
                            }`}
                          >
                            {u.isActive ? 'Active' : 'Disabled'}
                          </span>
                          {isDefaultAdmin && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-800 border border-amber-200">
                              Default Admin
                            </span>
                          )}
                          {typeof u.activeSessionCount === 'number' && u.activeSessionCount > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {u.activeSessionCount} active session{u.activeSessionCount > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#5B738B]">
                          {u.email && (
                            <span>
                              Login Email: <strong className="font-mono text-[#354A5F]">{u.email}</strong>
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-[#0A6ED1]" />
                            Plants:{' '}
                            <strong className="text-[#1C2833]">
                              {u.roleName === 'admin' || u.allowedPlants?.includes('ALL')
                                ? 'All Plants'
                                : (u.allowedPlants && u.allowedPlants.length > 0
                                    ? u.allowedPlants
                                    : ['RIYADH']
                                  )
                                    .map(
                                      (pid) =>
                                        plantOptions.find((pl) => pl.id === pid)?.name || pid
                                    )
                                    .join(', ')}
                            </strong>
                          </span>
                          <span>
                            Last login: {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                          </span>
                          {u.roleName !== 'admin' && (
                            <span>
                              Permissions: <strong className="text-[#354A5F]">{u.permissions.length}</strong>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditModal(u)}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-[#F4F7FA] hover:bg-[#E7EEF5] text-[#354A5F] border border-[#C2D0DF] flex items-center gap-1 cursor-pointer"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>

                        {u.roleName !== 'admin' && (
                          <button
                            type="button"
                            onClick={() => {
                              setPermTargetUser(u);
                              setPermSelection([...u.permissions]);
                            }}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1 cursor-pointer"
                          >
                            <Sliders className="w-3 h-3" />
                            <span>Sections</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setResetTargetUser(u);
                            setResetTempPass('');
                          }}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1 cursor-pointer"
                        >
                          <KeyRound className="w-3 h-3" />
                          <span>Reset PW</span>
                        </button>

                        {!isSelf && (
                          <button
                            type="button"
                            onClick={() => handleRevokeSessions(u)}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 flex items-center gap-1 cursor-pointer"
                            title="Force sign out all sessions"
                          >
                            <LogOut className="w-3 h-3" />
                            <span>Revoke</span>
                          </button>
                        )}

                        {!isSelf && !isDefaultAdmin && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteUser(u)}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : activeTab === 'audit' ? (
            <div className="space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-[#6A829C] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Search audit logs by username, action, or details..."
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#C2D0DF]"
                />
              </div>
              <div className="border border-[#DCE5EE] rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F4F7FA] text-[#354A5F] border-b border-[#DCE5EE]">
                    <tr>
                      <th className="px-3 py-2 font-extrabold">Time</th>
                      <th className="px-3 py-2 font-extrabold">Actor</th>
                      <th className="px-3 py-2 font-extrabold">Action</th>
                      <th className="px-3 py-2 font-extrabold">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF3F8]">
                    {filteredLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-[#F8FAFC]">
                        <td className="px-3 py-2 whitespace-nowrap text-[11px] text-[#5B738B]">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 font-mono font-bold text-[#1C2833]">
                          {log.actorUsername || 'system'}
                        </td>
                        <td className="px-3 py-2 font-bold text-[#0A6ED1]">{log.action}</td>
                        <td className="px-3 py-2 text-[#354A5F]">{log.details}</td>
                      </tr>
                    ))}
                    {filteredLogs.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-[#5B738B]">
                          No audit log entries matched your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="border border-[#DCE5EE] rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F4F7FA] text-[#354A5F] border-b border-[#DCE5EE]">
                  <tr>
                    <th className="px-3 py-2 font-extrabold">User</th>
                    <th className="px-3 py-2 font-extrabold">Role</th>
                    <th className="px-3 py-2 font-extrabold">IP Address</th>
                    <th className="px-3 py-2 font-extrabold">Last Activity</th>
                    <th className="px-3 py-2 font-extrabold">Expires</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF3F8]">
                  {sessions.map((s) => (
                    <tr key={s.sessionRef} className="hover:bg-[#F8FAFC]">
                      <td className="px-3 py-2 font-mono font-bold text-[#1C2833]">
                        @{s.username} ({s.fullName})
                      </td>
                      <td className="px-3 py-2">{s.roleName}</td>
                      <td className="px-3 py-2 font-mono text-[11px]">{s.ipAddress || '-'}</td>
                      <td className="px-3 py-2 text-[11px] text-[#5B738B]">
                        {new Date(s.lastActivityAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-[#5B738B]">
                        {new Date(s.expiresAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {sessions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-[#5B738B]">
                        {staticMode
                          ? 'In Cloud / Static Firebase mode, session tokens are managed securely by Firebase Authentication.'
                          : 'No active sessions found.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveEdit}
            data-preserve-case="true"
            className="bg-white rounded-2xl shadow-2xl border border-[#C2D0DF] w-full max-w-md p-5 space-y-3.5"
          >
            <div className="flex items-center justify-between border-b pb-2.5">
              <h3 className="text-sm font-black text-[#1C2833]">Edit User @{editingUser.username}</h3>
              <button type="button" onClick={() => setEditingUser(null)} className="text-neutral-500 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#354A5F] mb-1">Full Name *</label>
              <input
                type="text"
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                required
                className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#C2D0DF]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#354A5F] mb-1">Google / Work Email</label>
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#C2D0DF]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#354A5F] mb-1">Role / Section</label>
              <select
                value={editRoleName}
                onChange={(e) => setEditRoleName(e.target.value as UserRoleName)}
                disabled={editingUser.id === currentUser.id}
                className="w-full px-3 py-1.5 text-xs font-bold rounded-lg border border-[#C2D0DF]"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.displayName}
                  </option>
                ))}
              </select>
            </div>
            {editRoleName !== 'admin' && (
              <div className="bg-slate-50 border border-[#DCE5EE] rounded-xl p-2.5 space-y-2">
                <span className="text-xs font-bold text-[#354A5F] flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-[#0A6ED1]" />
                  <span>Authorized Plants *</span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <label
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-bold cursor-pointer ${
                      editAllowedPlants.includes('ALL')
                        ? 'bg-indigo-50 text-indigo-800 border-indigo-300'
                        : 'bg-white text-[#354A5F] border-slate-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={editAllowedPlants.includes('ALL')}
                      onChange={() => {
                        const next = togglePlantInList(editAllowedPlants, 'ALL');
                        setEditAllowedPlants(next);
                        setEditDefaultPlantId(resolveDefaultPlantForList(next, editDefaultPlantId));
                      }}
                      className="rounded text-[#0A6ED1]"
                    />
                    <span>All Plants</span>
                  </label>
                  {plantOptions.map((pl) => {
                    const checked = !editAllowedPlants.includes('ALL') && editAllowedPlants.includes(pl.id);
                    return (
                      <label
                        key={pl.id}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-bold cursor-pointer ${
                          checked
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                            : 'bg-white text-[#354A5F] border-slate-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = togglePlantInList(editAllowedPlants, pl.id);
                            setEditAllowedPlants(next);
                            setEditDefaultPlantId(resolveDefaultPlantForList(next, editDefaultPlantId));
                          }}
                          className="rounded text-[#0A6ED1]"
                        />
                        <span>{pl.name}</span>
                      </label>
                    );
                  })}
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#354A5F] mb-1">Default Plant</label>
                  <select
                    value={editDefaultPlantId}
                    onChange={(e) => setEditDefaultPlantId(e.target.value)}
                    className="w-full px-2.5 py-1 text-xs font-bold rounded-lg border border-[#C2D0DF] bg-white"
                  >
                    {(editAllowedPlants.includes('ALL')
                      ? plantOptions
                      : plantOptions.filter((pl) => editAllowedPlants.includes(pl.id))
                    ).map((pl) => (
                      <option key={pl.id} value={pl.id}>
                        {pl.name} ({pl.id})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-xs font-bold text-[#354A5F] cursor-pointer">
              <input
                type="checkbox"
                checked={editIsActive}
                onChange={(e) => setEditIsActive(e.target.checked)}
                disabled={editingUser.id === currentUser.id}
                className="rounded text-[#0A6ED1]"
              />
              {editIsActive ? <Unlock className="w-3.5 h-3.5 text-emerald-600" /> : <Lock className="w-3.5 h-3.5 text-red-600" />}
              <span>Account Active (Authorized to Sign In)</span>
            </label>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <input
                ref={editSigRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  try {
                    const dataUrl = await processSignatureFile(file);
                    setEditSignatureDataUrl(dataUrl);
                  } catch (err: any) {
                    showToast('error', err?.message || 'Invalid signature image.');
                  }
                }}
              />
              <button
                type="button"
                onClick={() => editSigRef.current?.click()}
                className="px-2.5 py-1 rounded-lg bg-[#EAF1F8] text-[#0A6ED1] text-xs font-bold cursor-pointer"
              >
                {editSignatureDataUrl ? 'Change Signature' : 'Upload Signature'}
              </button>
              {editSignatureDataUrl && (
                <>
                  <img src={editSignatureDataUrl} alt="Sig" className="h-7 border rounded px-1" />
                  <button
                    type="button"
                    onClick={() => setEditSignatureDataUrl('')}
                    className="text-xs text-red-600 font-bold cursor-pointer"
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-neutral-100 text-neutral-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#0A6ED1] text-white cursor-pointer"
              >
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Section Permissions Modal */}
      {permTargetUser && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#C2D0DF] w-full max-w-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-2.5">
              <div>
                <h3 className="text-sm font-black text-[#1C2833]">
                  Section Permissions for @{permTargetUser.username}
                </h3>
                <p className="text-[11px] text-[#5B738B]">Role: {permTargetUser.roleDisplayName}</p>
              </div>
              <button type="button" onClick={() => setPermTargetUser(null)} className="text-neutral-500 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {getAllowedPermissionsForRole(permTargetUser.roleName).map((perm) => {
                const checked = permSelection.includes(perm.key);
                return (
                  <label
                    key={perm.id}
                    className={`flex items-start gap-2 p-2.5 rounded-xl border text-xs cursor-pointer ${
                      checked ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setPermSelection((prev) => [...prev, perm.key]);
                        } else {
                          setPermSelection((prev) => prev.filter((k) => k !== perm.key));
                        }
                      }}
                      className="mt-0.5 rounded text-[#0A6ED1]"
                    />
                    <div>
                      <span className="font-bold text-[#1C2833] block">{perm.name}</span>
                      <span className="text-[10px] font-mono text-[#5B738B]">{perm.key}</span>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setPermTargetUser(null)}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-neutral-100 text-neutral-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingPerms}
                onClick={handleSavePermissions}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#0A6ED1] text-white cursor-pointer"
              >
                {savingPerms ? 'Saving...' : 'Save Permissions'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTargetUser && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleResetPassword}
            data-preserve-case="true"
            className="bg-white rounded-2xl shadow-2xl border border-[#C2D0DF] w-full max-w-sm p-5 space-y-3"
          >
            <h3 className="text-sm font-black text-[#1C2833]">
              Reset Password for @{resetTargetUser.username}
            </h3>
            <div>
              <label className="block text-xs font-bold text-[#354A5F] mb-1">New Temporary Password *</label>
              <input
                type="text"
                value={resetTempPass}
                onChange={(e) => setResetTempPass(e.target.value)}
                placeholder="e.g. Reset@2026!"
                required
                className="w-full px-3 py-2 text-xs font-semibold rounded-lg border border-[#C2D0DF]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setResetTargetUser(null)}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-neutral-100 text-neutral-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingReset}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-amber-600 text-white cursor-pointer"
              >
                {savingReset ? 'Resetting...' : 'Reset Password'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation */}
      {confirmDeleteUser && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-red-200 w-full max-w-sm p-5 space-y-3">
            <h3 className="text-sm font-black text-red-700">Delete User @{confirmDeleteUser.username}?</h3>
            <p className="text-xs text-[#354A5F]">
              This permanently removes access for <strong>{confirmDeleteUser.fullName}</strong>. Operational tickets and loading slips remain preserved.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteUser(null)}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-neutral-100 text-neutral-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteUser(confirmDeleteUser)}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-red-600 text-white cursor-pointer"
              >
                Delete User
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
