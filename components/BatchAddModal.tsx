import React, { useState } from 'react';
import { Button } from './Button';
import { AvailabilitySlot, Interviewer } from '../types';
import { generateTimeSlots } from '../constants';
import { getYear, isValid, parse, format } from 'date-fns';

interface BatchAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (slots: Partial<AvailabilitySlot>[], interviewerName: string) => Promise<void>;
  interviewers: Interviewer[];
}

export const BatchAddModal: React.FC<BatchAddModalProps> = ({ isOpen, onClose, onConfirm, interviewers }) => {
  const [name, setName] = useState('');
  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [selectedTimes, setSelectedTimes] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const currentYear = getYear(new Date());
  const timeSlots = generateTimeSlots(); // 09:00, 09:30...

  // Toggles
  const toggleSelection = (item: number | string, list: any[], setList: React.Dispatch<React.SetStateAction<any[]>>) => {
    if (list.includes(item)) {
      setList(list.filter(i => i !== item));
    } else {
      setList([...list, item]);
    }
  };

  const handleConfirm = async () => {
    if (!name.trim()) {
      alert("請輸入面試員姓名");
      return;
    }
    if (selectedMonths.length === 0 || selectedDays.length === 0 || selectedTimes.length === 0) {
      alert("請至少選擇一個月份、日期和時段");
      return;
    }

    setIsSubmitting(true);
    const newSlots: Partial<AvailabilitySlot>[] = [];

    // Generate combinations
    selectedMonths.forEach(month => {
      selectedDays.forEach(day => {
        // Construct date string YYYY-MM-DD
        const dateStr = `${currentYear}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        const dateObj = parse(dateStr, 'yyyy-MM-dd', new Date());

        // Validate date (e.g., skip Feb 30)
        if (isValid(dateObj) && dateObj.getMonth() + 1 === month) {
           selectedTimes.forEach(startTime => {
             // Calculate end time (assuming 30 mins duration for base slots, or next slot)
             const startDate = parse(startTime, 'HH:mm', new Date());
             const endDate = new Date(startDate.getTime() + 30 * 60000); // Add 30 mins
             const endTime = format(endDate, 'HH:mm');

             newSlots.push({
               date: dateStr,
               startTime: startTime,
               endTime: endTime,
               isBooked: false
             });
           });
        }
      });
    });

    await onConfirm(newSlots, name);
    
    // Reset Form for rapid entry
    setName('');
    setSelectedMonths([]);
    setSelectedDays([]);
    setSelectedTimes([]);
    setIsSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-200">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
          <h2 className="text-xl font-bold text-gray-800">批量新增時段 (快速模式)</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* 1. Name */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">1. 面試員姓名</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 p-2.5 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="輸入姓名..."
                list="interviewer-list"
              />
              <datalist id="interviewer-list">
                {interviewers.map(i => <option key={i.id} value={i.name} />)}
              </datalist>
            </div>
          </div>

          {/* 2. Months */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">2. 選擇月份 (可複選)</label>
            <div className="grid grid-cols-6 sm:grid-cols-12 gap-2">
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <button
                  key={m}
                  onClick={() => toggleSelection(m, selectedMonths, setSelectedMonths)}
                  className={`py-2 rounded-md text-sm font-medium transition-colors border ${
                    selectedMonths.includes(m)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {m}月
                </button>
              ))}
            </div>
          </div>

          {/* 3. Days */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">3. 選擇日期 (可複選)</label>
            <div className="grid grid-cols-7 sm:grid-cols-10 gap-2">
              {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                <button
                  key={d}
                  onClick={() => toggleSelection(d, selectedDays, setSelectedDays)}
                  className={`py-2 rounded-md text-sm font-medium transition-colors border ${
                    selectedDays.includes(d)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* 4. Times */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">4. 選擇時段 (可複選, 預設每段30分鐘)</label>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {timeSlots.map(t => (
                <button
                  key={t}
                  onClick={() => toggleSelection(t, selectedTimes, setSelectedTimes)}
                  className={`py-1.5 rounded-md text-xs font-medium transition-colors border ${
                    selectedTimes.includes(t)
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-gray-100 flex justify-end gap-3">
             <Button variant="ghost" onClick={onClose}>關閉</Button>
             <Button variant="primary" onClick={handleConfirm} isLoading={isSubmitting}>
               確認新增並清空
             </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
