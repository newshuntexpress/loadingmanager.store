import React, { useState } from 'react';
import { TicketRecord, TruckLoadingType, CompanySettings } from '../types';
import { StorageService, resolveSettingsForPlant } from '../services/storage';
import { ApiClient } from '../services/api';
import { formatSaudiPhoneNumber } from '../utils/whatsapp';
import { resolveLoadingType, inferLoadingTypeFromDestination } from '../utils/loadingType';
import {
  Edit2,
  Truck,
  User,
  Phone,
  MapPin,
  Building2,
  DoorOpen,
  Hash,
  AlertCircle,
  Save,
  X,
  FileText,
  Globe,
  ArrowLeftRight,
} from 'lucide-react';

interface EditTicketModalProps {
  ticket: TicketRecord;
  settings: CompanySettings;
  onSave: (updatedTicket: TicketRecord) => void;
  onClose: () => void;
}

export const EditTicketModal: React.FC<EditTicketModalProps> = ({
  ticket,
  settings,
  onSave,
  onClose,
}) => {
  const plantSettings = resolveSettingsForPlant(settings, ticket.plantId);
  const [delNoteNumber, setDelNoteNumber] = useState(ticket.delNoteNumber || ticket.loadingSlip?.delNoteNumber || '');
  const [truckNumber, setTruckNumber] = useState(ticket.truckNumber || '');
  const [driverName, setDriverName] = useState(ticket.driverName || '');
  const [driverPhone, setDriverPhone] = useState(() => formatSaudiPhoneNumber(ticket.driverPhone || ''));
  const [iqamaNumber, setIqamaNumber] = useState(ticket.iqamaNumber || '');
  const [destinationPlace, setDestinationPlace] = useState(ticket.destinationPlace || '');
  const [loadingType, setLoadingType] = useState<TruckLoadingType>(() => resolveLoadingType(ticket));
  const [loadingTypeManual, setLoadingTypeManual] = useState(() => Boolean(ticket.loadingType));
  const [transporterName, setTransporterName] = useState(ticket.transporterName || '');
  const [selectedGate, setSelectedGate] = useState(ticket.gateNumber || plantSettings.gates[0] || 'Gate 1');
  const [priority, setPriority] = useState<'normal' | 'urgent'>(ticket.priority || 'normal');
  const [remarks, setRemarks] = useState(ticket.remarks || '');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const gateOptions = plantSettings.gates.includes(ticket.gateNumber)
    ? plantSettings.gates
    : [ticket.gateNumber, ...plantSettings.gates].filter(Boolean);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!delNoteNumber.trim()) {
      setFormError('Delivery Note Number (Del Note No.) is required.');
      return;
    }
    if (!truckNumber.trim()) {
      setFormError('Vehicle / Truck Number is required.');
      return;
    }
    if (!driverName.trim()) {
      setFormError('Driver Name is required.');
      return;
    }
    if (!driverPhone.trim()) {
      setFormError('Driver Mobile Number is required.');
      return;
    }
    if (!selectedGate.trim()) {
      setFormError('Please select a Loading Gate.');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await ApiClient.updateTicket(ticket.id, {
        delNoteNumber: delNoteNumber.trim().toUpperCase(),
        truckNumber: truckNumber.trim().toUpperCase(),
        driverName: driverName.trim().toUpperCase(),
        driverPhone: formatSaudiPhoneNumber(driverPhone),
        iqamaNumber: iqamaNumber.trim().toUpperCase(),
        destinationPlace: destinationPlace.trim().toUpperCase(),
        loadingType,
        transporterName: transporterName.trim().toUpperCase(),
        gateNumber: selectedGate.trim(),
        priority,
        remarks: remarks.trim().toUpperCase(),
        version: ticket.version,
      });
      onSave(updated);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to update ticket record.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-2xl shadow-2xl border border-neutral-200 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#0A6ED1] via-[#2B4E72] to-[#1D3248] text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-md">
              <Edit2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold">Edit Gate Ticket &amp; Change Gate</h2>
              <p className="text-xs text-blue-100 font-mono">
                {ticket.ticketNumber} · Daily Seq #{ticket.sequenceNumber} · Current Gate: {ticket.gateNumber}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-blue-100 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[78vh] overflow-y-auto">
          {/* Gate Selection */}
          <div className="bg-blue-50/75 p-3.5 rounded-xl border border-blue-200">
            <label className="text-xs font-black text-blue-950 tracking-wide block mb-2">
              Assigned Loading Gate (Click to Change Gate)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {gateOptions.map((gate) => {
                const info = StorageService.getGateQueueInfo(gate, ticket.date);
                const isSelected = selectedGate === gate;
                return (
                  <button
                    key={gate}
                    type="button"
                    onClick={() => setSelectedGate(gate)}
                    className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between cursor-pointer ${
                      isSelected
                        ? 'border-blue-700 bg-white ring-2 ring-blue-500/30 shadow-sm'
                        : 'border-blue-200/80 bg-white/70 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-extrabold text-xs text-neutral-900">{gate}</span>
                      <DoorOpen className={`w-4 h-4 ${isSelected ? 'text-blue-700' : 'text-neutral-400'}`} />
                    </div>
                    <div className="text-[10px]">
                      {info.currentLoading ? (
                        <p className="text-amber-800 font-semibold truncate">Loading: {info.currentLoading.truckNumber}</p>
                      ) : (
                        <p className="text-emerald-700 font-semibold">Available</p>
                      )}
                      <p className="text-neutral-500">{info.waitingQueue.length} waiting</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Delivery Note & Truck */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                Delivery Note Number (Del Note No.) *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                  <FileText className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={delNoteNumber}
                  onChange={(e) => setDelNoteNumber(e.target.value.toUpperCase())}
                  required
                  className="w-full pl-9 pr-3 py-2 text-xs font-black uppercase rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                Vehicle / Truck Number *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                  <Truck className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={truckNumber}
                  onChange={(e) => setTruckNumber(e.target.value.toUpperCase())}
                  required
                  className="w-full pl-9 pr-3 py-2 text-xs font-black uppercase rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white font-mono"
                />
              </div>
            </div>
          </div>

          {/* Driver Name, Mobile & Iqama */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">Driver Name *</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  required
                  className="w-full pl-9 pr-3 py-2 text-xs font-semibold rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">Driver Mobile *</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                  <Phone className="w-4 h-4 text-emerald-600" />
                </div>
                <input
                  type="text"
                  value={driverPhone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  onBlur={handlePhoneBlur}
                  required
                  className="w-full pl-9 pr-3 py-2 text-xs font-bold rounded-xl border border-neutral-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">ID / Iqama Number</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                  <Hash className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={iqamaNumber}
                  onChange={(e) => setIqamaNumber(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs font-semibold rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white font-mono"
                />
              </div>
            </div>
          </div>

          {/* Destination, Loading Type (Local / Export) & Transporter */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                Destination Place / Unloading Point
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                  <MapPin className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={destinationPlace}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDestinationPlace(val);
                    if (!loadingTypeManual) {
                      const inferred = inferLoadingTypeFromDestination(val);
                      if (inferred) setLoadingType(inferred);
                    }
                  }}
                  className="w-full pl-9 pr-3 py-2 text-xs font-semibold rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                Truck Loading Type *
              </label>
              <div className="grid grid-cols-3 gap-1.5 bg-neutral-100 p-1 rounded-xl border border-neutral-300">
                <button
                  type="button"
                  onClick={() => {
                    setLoadingType('local');
                    setLoadingTypeManual(true);
                  }}
                  className={`py-1.5 px-2 rounded-lg text-xs font-extrabold transition flex items-center justify-center gap-1 cursor-pointer ${
                    loadingType === 'local'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-neutral-600 hover:text-neutral-900 hover:bg-white'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span>Local</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoadingType('export');
                    setLoadingTypeManual(true);
                  }}
                  className={`py-1.5 px-2 rounded-lg text-xs font-extrabold transition flex items-center justify-center gap-1 cursor-pointer ${
                    loadingType === 'export'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-neutral-600 hover:text-neutral-900 hover:bg-white'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5 shrink-0" />
                  <span>Export</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoadingType('sto');
                    setLoadingTypeManual(true);
                  }}
                  className={`py-1.5 px-2 rounded-lg text-xs font-extrabold transition flex items-center justify-center gap-1 cursor-pointer ${
                    loadingType === 'sto'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-neutral-600 hover:text-neutral-900 hover:bg-white'
                  }`}
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
                  <span>STO</span>
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                Transporter / Company Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                  <Building2 className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={transporterName}
                  onChange={(e) => setTransporterName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs font-medium rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                />
              </div>
            </div>
          </div>

          {/* Priority & Remarks */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">Loading Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'normal' | 'urgent')}
                className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
              >
                <option value="normal">Normal Loading</option>
                <option value="urgent">Urgent / Express Loading</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-bold text-neutral-700 block mb-1">Special Remarks / Notes</label>
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
              />
            </div>
          </div>

          {formError && (
            <div className="p-3 bg-red-50 rounded-xl border border-red-200 text-xs font-semibold text-red-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-3 border-t border-neutral-200">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="app-btn w-full sm:w-auto sm:min-w-[110px] text-neutral-700 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="app-btn w-full sm:w-auto sm:min-w-[150px] bg-[#0A6ED1] hover:bg-[#085CAF] text-white shadow"
            >
              <Save className="w-4 h-4 shrink-0" />
              <span>{submitting ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
