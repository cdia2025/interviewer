
import React, { useMemo, useState, useEffect } from 'react';
import { format, parse, isSameMonth, startOfMonth, endOfMonth, subMonths, addMonths, isValid } from 'date-fns';
import { AvailabilitySlot, Interviewer } from '../types';
import { Button } from './Button';

interface StatisticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  slots: AvailabilitySlot[];
  interviewers: Interviewer[];
  currentDate: Date;
}

export const StatisticsModal: React.FC<StatisticsModalProps> = ({
  isOpen,
  onClose,
  slots,
  interviewers,
  currentDate
}) => {
  const [statDate, setStatDate] = useState(currentDate);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset date when opening
  useEffect(() => {
    if (isOpen) {
        setStatDate(currentDate);
    }
  }, [isOpen, currentDate]);

  const timeToMinutes = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  };

  // Calculate stats for the month (Units of 30 mins)
  const monthStats = useMemo(() => {
    const monthSlots = slots.filter(s => {
       const d = parse(s.date, 'yyyy-MM-dd', new Date());
       return isValid(d) && isSameMonth(d, statDate);
    });

    const statsMap = new Map<string, { id: string; available: number; booked: number; name: string; color: string }>();

    // We scan slots to find active interviewers for this month
    monthSlots.forEach(slot => {
        const inv = interviewers.find(i => i.id === slot.interviewerId);
        if (!inv) return; 
        
        if (!statsMap.has(inv.id)) {
            statsMap.set(inv.id, { id: inv.id, available: 0, booked: 0, name: inv.name, color: inv.color });
        }
        
        const entry = statsMap.get(inv.id)!;
        
        // Calculate units (30 mins = 1 unit)
        const startMins = timeToMinutes(slot.startTime);
        const endMins = timeToMinutes(slot.endTime);
        const duration = endMins - startMins;
        const units = duration > 0 ? duration / 30 : 0;

        if (slot.isBooked) {
            entry.booked += units;
        } else {
            entry.available += units;
        }
    });

    return Array.from(statsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [slots, interviewers, statDate]);

  // Initialize selection when monthStats changes
  useEffect(() => {
      setSelectedIds(new Set(monthStats.map(s => s.id)));
  }, [monthStats]);

  const toggleSelection = (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedIds(next);
  };

  const toggleAll = () => {
      if (selectedIds.size === monthStats.length) {
          setSelectedIds(new Set());
      } else {
          setSelectedIds(new Set(monthStats.map(s => s.id)));
      }
  };

  // Calculate totals based on selection
  const totals = useMemo(() => {
      return monthStats.reduce((acc, curr) => {
          if (selectedIds.has(curr.id)) {
              acc.available += curr.available;
              acc.booked += curr.booked;
          }
          return acc;
      }, { available: 0, booked: 0 });
  }, [monthStats, selectedIds]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
       <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
             <div>
                <h2 className="text-xl font-bold text-gray-800">時段統計 (30分鐘/單位)</h2>
                <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => setStatDate(subMonths(statDate, 1))} className="p-1 hover:bg-gray-200 rounded text-gray-600 transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                    </button>
                    <span className="text-base font-bold text-blue-600 w-32 text-center bg-white py-1 rounded shadow-sm border border-gray-100">
                        {format(statDate, 'yyyy-MM')}
                    </span>
                    <button onClick={() => setStatDate(addMonths(statDate, 1))} className="p-1 hover:bg-gray-200 rounded text-gray-600 transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                    </button>
                </div>
             </div>
             <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
               <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
             </button>
          </div>

          {/* Content */}
          <div className="p-0 overflow-y-auto flex-1">
             <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-500 uppercase bg-gray-50 sticky top-0 z-10 shadow-sm">
                    <tr>
                        <th className="px-6 py-4 w-12">
                            <input 
                                type="checkbox" 
                                checked={monthStats.length > 0 && selectedIds.size === monthStats.length}
                                onChange={toggleAll}
                                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                        </th>
                        <th className="px-4 py-4">面試員</th>
                        <th className="px-4 py-4 text-right">可預約 (Available)</th>
                        <th className="px-4 py-4 text-right">已預約 (Booked)</th>
                        <th className="px-6 py-4 text-right">小計 (Subtotal)</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {monthStats.length > 0 ? (
                        monthStats.map(item => (
                            <tr key={item.id} className={`hover:bg-gray-50 transition-colors ${selectedIds.has(item.id) ? '' : 'opacity-50 grayscale'}`}>
                                <td className="px-6 py-3">
                                    <input 
                                        type="checkbox" 
                                        checked={selectedIds.has(item.id)}
                                        onChange={() => toggleSelection(item.id)}
                                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                </td>
                                <td className="px-4 py-3 font-medium text-gray-900 flex items-center gap-3">
                                    <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: item.color }} />
                                    {item.name}
                                </td>
                                <td className="px-4 py-3 text-right text-emerald-600 font-medium">{item.available}</td>
                                <td className="px-4 py-3 text-right text-gray-400">{item.booked}</td>
                                <td className="px-6 py-3 text-right font-bold text-gray-800">{item.available + item.booked}</td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={5} className="px-6 py-12 text-center text-gray-400 italic bg-gray-50/30">
                                本月無面試資料
                            </td>
                        </tr>
                    )}
                </tbody>
             </table>
          </div>

          {/* Footer Totals */}
          <div className="bg-blue-50 border-t border-blue-100 p-4 sticky bottom-0 z-10">
              <div className="flex justify-between items-center px-2">
                  <div className="text-sm text-blue-800 font-medium">
                      已選取: <span className="font-bold">{selectedIds.size}</span> 位
                  </div>
                  <div className="flex gap-8 text-sm">
                      <div className="flex flex-col items-end">
                          <span className="text-xs text-blue-600 uppercase font-semibold">可預約總計</span>
                          <span className="text-xl font-bold text-emerald-600">{totals.available}</span>
                      </div>
                      <div className="flex flex-col items-end">
                          <span className="text-xs text-blue-600 uppercase font-semibold">已預約總計</span>
                          <span className="text-xl font-bold text-gray-500">{totals.booked}</span>
                      </div>
                      <div className="flex flex-col items-end pl-6 border-l border-blue-200">
                          <span className="text-xs text-blue-600 uppercase font-semibold">全部總計</span>
                          <span className="text-xl font-bold text-blue-900">{totals.available + totals.booked}</span>
                      </div>
                  </div>
              </div>
          </div>
       </div>
    </div>
  );
};