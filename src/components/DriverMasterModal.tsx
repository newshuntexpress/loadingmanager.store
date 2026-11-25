import React, { useState } from 'react';
import { DriverMasterRecord } from '../types';
import { StorageService } from '../services/storage';
import { ApiClient } from '../services/api';
import { formatSaudiPhoneNumber } from '../utils/whatsapp';
import { Users, Plus, Trash2, Edit2, Search, X, Save } from 'lucide-react';

interface DriverMasterModalProps {
  onClose: () => void;
  onSelectForNewTicket?: (driver: DriverMasterRecord) => void;
  canManage?: boolean;
}

export const DriverMasterModal: React.FC<DriverMasterModalProps> = ({
  onClose,
  onSelectForNewTicket: _onSelectForNewTicket,
  canManage = true,
}) => {
  const [drivers, setDrivers] = useState<DriverMasterRecord[]>(() => StorageService.getDrivers());
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form for new/edited driver
  const [truckNumber, setTruckNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [iqamaNumber, setIqamaNumber] = useState('');
  const [transporterName, setTransporterName] = useState('');
  const [defaultDestination, setDefaultDestination] = useState('');

  const handlePhoneChange = (val: string) => {
    setDriverPhone(val);
    const digits = val.replace(/\D/g, '');
    if (digits.startsWith('05') && digits.length === 10) {
      setDriverPhone('+966' + digits.slice(1));
    } else if (digits.startsWith('5') && digits.length === 9) {
      setDriverPhone('+966' + digits);
    }
  };

  const handlePhoneBlur = () => {
    if (driverPhone.trim()) {
      setDriverPhone(formatSaudiPhoneNumber(driverPhone));
    }
  };

  const filtered = drivers.filter(
    (d) =>
      d.truckNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.driverName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.driverPhone.includes(searchQuery) ||
      (d.iqamaNumber && d.iqamaNumber.includes(searchQuery)) ||
      d.transporterName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleStartEdit = (d: DriverMasterRecord) => {
    setEditingId(d.id);
    setTruckNumber(d.truckNumber);
    setDriverName(d.driverName);
    setDriverPhone(formatSaudiPhoneNumber(d.driverPhone));
    setIqamaNumber(d.iqamaNumber || '');
    setTransporterName(d.transporterName || '');
    setDefaultDestination(d.defaultDestination || '');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setTruckNumber('');
    setDriverName('');
    setDriverPhone('');
    setIqamaNumber('');
    setTransporterName('');
    setDefaultDestination('');
  };

  const handleSave = async () => {
    setErrorMsg(null);
    if (!truckNumber.trim() || !driverName.trim() || !driverPhone.trim()) {
      setErrorMsg('Please enter Vehicle Number, Driver Name, and Mobile Number!');
      return;
    }

    const formattedPhone = formatSaudiPhoneNumber(driverPhone);

    try {
      const saved = await ApiClient.saveDriver({
        ...(editingId ? { id: editingId } : {}),
        truckNumber: truckNumber.trim().toUpperCase(),
        driverName: driverName.trim(),
        driverPhone: formattedPhone,
        iqamaNumber: iqamaNumber.trim(),
        transporterName: transporterName.trim(),
        defaultDestination: defaultDestination.trim(),
        lastVisited: new Date().toISOString().split('T')[0],
      });

      const updated = editingId
        ? drivers.map((d) => (d.id === editingId ? saved : d))
        : [saved, ...drivers.filter((d) => d.id !== saved.id)];
      setDrivers(updated);
      StorageService.saveDrivers(updated);
      handleCancelEdit();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save driver record.');
    }
  };

  const handleDelete = async (id: string) => {
    setErrorMsg(null);
    try {
      await ApiClient.deleteDriver(id);
      const updated = drivers.filter((d) => d.id !== id);
      setDrivers(updated);
      StorageService.saveDrivers(updated);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete driver record.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-2xl shadow-2xl border border-neutral-200 w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-neutral-900 to-neutral-800 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl">
              <Users className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Driver & Vehicle Master Directory</h2>
              <p className="text-xs text-neutral-300">
                Saved Master Records for Instant Auto-Fill
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-xl text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          {/* Add / Edit Form Card */}
          {canManage && (
          <div className="bg-neutral-50 p-4 rounded-xl border border-neutral-200">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-700 mb-3 flex items-center gap-1.5">
              {editingId ? <Edit2 className="w-4 h-4 text-blue-600" /> : <Plus className="w-4 h-4 text-emerald-600" />}
              <span>{editingId ? 'Edit Driver Record' : 'Add New Driver & Vehicle Record'}</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-neutral-600 block mb-1">Vehicle / Truck No *</label>
                <input
                  type="text"
                  value={truckNumber}
                  onChange={(e) => setTruckNumber(e.target.value)}
                  placeholder="e.g. 5275 AXG"
                  className="w-full px-3 py-1.5 text-xs font-bold uppercase rounded-lg border border-neutral-300 focus:ring-2 focus:ring-neutral-800 focus:outline-none bg-white"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-neutral-600 block mb-1">Driver Name *</label>
                <input
                  type="text"
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  placeholder="e.g. Rameshwar Yadav"
                  className="w-full px-3 py-1.5 text-xs font-medium rounded-lg border border-neutral-300 focus:ring-2 focus:ring-neutral-800 focus:outline-none bg-white"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-neutral-600">Mobile / WhatsApp *</label>
                  <span className="text-[9.5px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                    🇸🇦 +966
                  </span>
                </div>
                <input
                  type="text"
                  value={driverPhone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  onBlur={handlePhoneBlur}
                  placeholder="e.g. 0550000000"
                  className="w-full px-3 py-1.5 text-xs font-bold rounded-lg border border-neutral-300 focus:ring-2 focus:ring-neutral-800 focus:outline-none bg-white font-mono"
                />
                <p className="text-[9.5px] text-neutral-500 mt-0.5">
                  💡 e.g. 0550000000 &rarr; Auto-formats to +966550000000
                </p>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-neutral-600 block mb-1">ID / Iqama Number</label>
                <input
                  type="text"
                  value={iqamaNumber}
                  onChange={(e) => setIqamaNumber(e.target.value)}
                  placeholder="e.g. 2481928491"
                  className="w-full px-3 py-1.5 text-xs font-medium rounded-lg border border-neutral-300 focus:ring-2 focus:ring-neutral-800 focus:outline-none bg-white font-mono"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-neutral-600 block mb-1">Transporter / Company Name</label>
                <input
                  type="text"
                  value={transporterName}
                  onChange={(e) => setTransporterName(e.target.value)}
                  placeholder="e.g. AWAZEL"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-neutral-300 focus:ring-2 focus:ring-neutral-800 focus:outline-none bg-white"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-neutral-600 block mb-1">Default Destination Place</label>
                <input
                  type="text"
                  value={defaultDestination}
                  onChange={(e) => setDefaultDestination(e.target.value)}
                  placeholder="e.g. RIYADH/JEDDAH/DAMMAM"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-neutral-300 focus:ring-2 focus:ring-neutral-800 focus:outline-none bg-white"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center justify-end gap-2 pt-1">
                {editingId && (
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="app-btn bg-neutral-200 hover:bg-neutral-300 text-neutral-700"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  className="app-btn bg-neutral-900 hover:bg-neutral-800 text-white shadow"
                >
                  <Save className="w-3.5 h-3.5 shrink-0" />
                  <span>{editingId ? 'Update Record' : 'Save Driver & Vehicle'}</span>
                </button>
              </div>
            </div>
          </div>
          )}

          {/* Search bar & list */}
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-neutral-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by truck no (e.g. 5275 AXG), driver, phone (050...), or Iqama..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-neutral-300 focus:ring-2 focus:ring-neutral-800 focus:outline-none bg-white shadow-sm"
              />
            </div>
            <span className="text-xs text-neutral-500 font-semibold">
              Total Saved: {drivers.length} Records
            </span>
          </div>

          {/* Table */}
          <div className="border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-neutral-100 text-neutral-800 text-[11px] uppercase tracking-wider font-bold border-b border-neutral-200">
                  <th className="py-2.5 px-3">Vehicle / Truck No</th>
                  <th className="py-2.5 px-3">Driver Name</th>
                  <th className="py-2.5 px-3">Mobile / WhatsApp</th>
                  <th className="py-2.5 px-3">ID / Iqama No</th>
                  <th className="py-2.5 px-3">Transporter / Company</th>
                  <th className="py-2.5 px-3">Default Destination</th>
                  <th className="py-2.5 px-3 text-center">Visits</th>
                  <th className="py-2.5 px-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {filtered.map((d) => (
                  <tr key={d.id} className="hover:bg-neutral-50 transition">
                    <td className="py-2 px-3 font-black text-blue-900 tracking-wide font-mono">
                      {d.truckNumber}
                    </td>
                    <td className="py-2 px-3 font-semibold text-blue-900">
                      {d.driverName}
                    </td>
                    <td className="py-2 px-3 font-medium text-blue-900 font-mono">
                      {d.driverPhone}
                    </td>
                    <td className="py-2 px-3 font-medium text-neutral-700 font-mono">
                      {d.iqamaNumber || '—'}
                    </td>
                    <td className="py-2 px-3 text-neutral-600">
                      {d.transporterName || '—'}
                    </td>
                    <td className="py-2 px-3 text-neutral-600">
                      {d.defaultDestination || '—'}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-neutral-100 text-neutral-700">
                        {d.tripCount || 1} Trips
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center">
                      {canManage ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(d)}
                            className="app-btn-sm bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200"
                            title="Edit record"
                          >
                            <Edit2 className="w-3.5 h-3.5 shrink-0" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(d.id)}
                            className="app-btn-sm bg-red-50 hover:bg-red-600 text-red-600 hover:text-white border border-red-200"
                            title="Delete record"
                          >
                            <Trash2 className="w-3.5 h-3.5 shrink-0" />
                            <span>Delete</span>
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-neutral-400">Read-only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
