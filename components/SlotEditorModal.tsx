
import React, { useState, useEffect } from 'react';
import { Button } from './Button';
import { AvailabilitySlot, Interviewer } from '../types';

interface SlotEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (slot: Partial<AvailabilitySlot>, interviewerName: string) => void;
  onDelete?: (id: string, isSplit?: boolean) => void;
  initialSlot?: AvailabilitySlot & { interviewer: Interviewer };
}

export const SlotEditorModal: React.FC<SlotEditorModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  initialSlot
}) => {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [isBooked, setIsBooked] = useState(false);

  useEffect(() => {
    if (initialSlot) {
      setName(initialSlot.interviewer.name);
      setDate(initialSlot.date);
      setStart(initialSlot.startTime);
      setEnd(initialSlot.endTime);
      setIsBooked(!!initialSlot.isBooked);
    } else {
      setName('');
      setDate(new Date().toISOString().split('T')[0]);
      setStart('09:00');
      setEnd('10:00');
      setIsBooked(false);
    }
  }, [initialSlot, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      id: initialSlot?.id,
      date,
      startTime: start,
      endTime: end,
      isBooked: isBooked
    }, name);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        <form onSubmit={handleSubmit} className="p-6">
          <h2 className="text-xl font-bold mb-6 text-gray-800">
            {initialSlot ? '修改/删除時段' : '新增可面試時段'}
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">面試員姓名</label>
              <input
                required
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-2.5 bg-slate-700 text-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none placeholder-slate-400"
                placeholder="例如: 陳大文"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">日期</label>
              <input
                required
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full p-2.5 bg-slate-700 text-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">開始時間</label>
                <input
                  required
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="w-full p-2.5 bg-slate-700 text-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">結束時間</label>
                <input
                  required
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="w-full p-2.5 bg-slate-700 text-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
              <input
                type="checkbox"
                id="isBooked"
                checked={isBooked}
                onChange={(e) => setIsBooked(e.target.checked)}
                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="isBooked" className="text-sm font-semibold text-gray-700 cursor-pointer">
                已預約 (Booked)
              </label>
            </div>
          </div>

          <div className="mt-8 flex gap-3">
            {initialSlot && onDelete && (
              <Button type="button" variant="danger" onClick={() => onDelete(initialSlot.id, true)}>此段删除</Button>
            )}
            <div className="flex-1"></div>
            <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
            <Button type="submit" variant="primary">儲存設定</Button>
          </div>
        </form>
      </div>
    </div>
  );
};
