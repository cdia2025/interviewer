
import React, { useState, useEffect } from 'react';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  addMonths, 
  subMonths,
  isSameDay
} from 'date-fns';
import { Button } from './Button';
import { Interviewer } from '../types';

interface TimeRange {
  startTime: string;
  endTime: string;
}

interface BatchAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: { name: string; dates: string[]; timeRanges: TimeRange[] }) => void;
  existingInterviewers: Interviewer[];
}

export const BatchAddModal: React.FC<BatchAddModalProps> = ({ 
  isOpen, 
  onClose, 
  onConfirm,
  existingInterviewers 
}) => {
  const [name, setName] = useState('');
  const [viewDate, setViewDate] = useState(new Date());
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [timeRanges, setTimeRanges] = useState<TimeRange[]>([{ startTime: '09:00', endTime: '12:00' }]);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setName('');
      setViewDate(new Date());
      setSelectedDates(new Set());
      setTimeRanges([{ startTime: '09:00', endTime: '12:00' }]);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Calendar Logic
  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(monthStart);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const toggleDate = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    setSelectedDates(prev => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  };

  const handleTimeChange = (index: number, field: keyof TimeRange, value: string) => {
    const newRanges = [...timeRanges];
    newRanges[index][field] = value;
    setTimeRanges(newRanges);
  };

  const addTimeRange = () => {
    setTimeRanges([...timeRanges, { startTime: '14:00', endTime: '17:00' }]);
  };

  const removeTimeRange = (index: number) => {
    if (timeRanges.length > 1) {
      setTimeRanges(timeRanges.filter((_, i) => i !== index));
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      alert('請輸入面試員姓名');
      return;
    }
    if (selectedDates.size === 0) {
      alert('請至少選擇一個日期');
      return;
    }
    
    // Convert Set to Array and sort
    const dates = Array.from(selectedDates).sort();
    onConfirm({ name, dates, timeRanges });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h2 className="text-xl font-bold text-gray-800">批量新增時段</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          {/* 1. Name Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">面試員姓名</label>
            <input
              type="text"
              list="interviewer-list"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-2.5 bg-slate-700 text-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none placeholder-slate-400"
              placeholder="輸入或選擇姓名..."
            />
            <datalist id="interviewer-list">
              {existingInterviewers.map(inv => (
                <option key={inv.id} value={inv.name} />
              ))}
            </datalist>
          </div>

          {/* 2. Calendar Multi-Select */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">選擇日期 ({selectedDates.size}天)</label>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex justify-between items-center p-2 bg-gray-50 border-b border-gray-200">
                <button onClick={() => setViewDate(subMonths(viewDate, 1))} className="p-1 hover:bg-gray-200 rounded"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg></button>
                <span className="font-bold text-gray-700">{format(viewDate, 'yyyy年 MMMM')}</span>
                <button onClick={() => setViewDate(addMonths(viewDate, 1))} className="p-1 hover:bg-gray-200 rounded"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg></button>
              </div>
              <div className="grid grid-cols-7 text-center text-xs font-semibold bg-gray-50 border-b border-gray-200">
                {['日', '一', '二', '三', '四', '五', '六'].map(d => <div key={d} className="py-2">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 bg-white">
                {calendarDays.map((day, idx) => {
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const isSelected = selectedDates.has(dateStr);
                  const isCurrentMonth = isSameMonth(day, viewDate);
                  return (
                    <div 
                      key={dateStr}
                      onClick={() => toggleDate(day)}
                      className={`
                        h-10 flex items-center justify-center cursor-pointer text-sm transition-colors border-r border-b border-gray-50
                        ${!isCurrentMonth ? 'text-gray-300' : 'text-gray-700 hover:bg-blue-50'}
                        ${isSelected ? 'bg-blue-600 text-white hover:bg-blue-700' : ''}
                        ${isSameDay(day, new Date()) && !isSelected ? 'text-blue-600 font-bold' : ''}
                      `}
                    >
                      {format(day, 'd')}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-2 text-xs text-gray-500 text-right">
                <button onClick={() => setSelectedDates(new Set())} className="text-red-500 hover:underline">清除所有日期</button>
            </div>
          </div>

          {/* 3. Time Ranges */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">設定時段</label>
            <div className="space-y-2">
              {timeRanges.map((range, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="time"
                    value={range.startTime}
                    onChange={(e) => handleTimeChange(idx, 'startTime', e.target.value)}
                    className="p-2 border rounded bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <span className="text-gray-400">to</span>
                  <input
                    type="time"
                    value={range.endTime}
                    onChange={(e) => handleTimeChange(idx, 'endTime', e.target.value)}
                    className="p-2 border rounded bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  {timeRanges.length > 1 && (
                    <button onClick={() => removeTimeRange(idx)} className="text-red-400 hover:text-red-600 p-1">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button 
              onClick={addTimeRange}
              className="mt-2 text-sm text-blue-600 hover:text-blue-800 flex items-center font-medium"
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
              新增另一個時段
            </button>
          </div>
        </div>

        <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleSubmit}>
            確認新增 ({selectedDates.size * timeRanges.length} 個時段)
          </Button>
        </div>
      </div>
    </div>
  );
};
