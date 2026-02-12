import React, { useState, useEffect } from 'react';
import { Button } from './Button';
import { format } from 'date-fns';
import { DayNote } from '../types';

interface NoteEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (date: string, content: string, color: string) => void;
  onDelete?: (date: string) => void;
  date: Date | null;
  initialNote?: DayNote;
}

const COLORS = [
  { id: 'yellow', bg: 'bg-yellow-100', ring: 'ring-yellow-400', label: '黃' },
  { id: 'blue', bg: 'bg-blue-100', ring: 'ring-blue-400', label: '藍' },
  { id: 'green', bg: 'bg-emerald-100', ring: 'ring-emerald-400', label: '綠' },
  { id: 'red', bg: 'bg-red-100', ring: 'ring-red-400', label: '紅' },
  { id: 'purple', bg: 'bg-purple-100', ring: 'ring-purple-400', label: '紫' },
] as const;

export const NoteEditorModal: React.FC<NoteEditorModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  date,
  initialNote
}) => {
  const [content, setContent] = useState('');
  const [selectedColor, setSelectedColor] = useState<string>('yellow');

  useEffect(() => {
    if (isOpen) {
      setContent(initialNote?.content || '');
      setSelectedColor(initialNote?.color || 'yellow');
    }
  }, [initialNote, isOpen]);

  if (!isOpen || !date) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(format(date, 'yyyy-MM-dd'), content, selectedColor);
    onClose();
  };

  const handleDelete = () => {
    if (onDelete) {
      onDelete(format(date, 'yyyy-MM-dd'));
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
        <form onSubmit={handleSubmit} className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold text-gray-800">
              {format(date, 'MM月dd日')} - 備註
            </h2>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
          
          <div className="mb-4">
             <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase">背景顏色</label>
             <div className="flex gap-3">
               {COLORS.map((c) => (
                 <button
                   key={c.id}
                   type="button"
                   onClick={() => setSelectedColor(c.id)}
                   className={`w-8 h-8 rounded-full ${c.bg} transition-all ${
                     selectedColor === c.id ? `ring-2 ${c.ring} scale-110 shadow-sm` : 'hover:scale-105'
                   }`}
                   title={c.label}
                 />
               ))}
             </div>
          </div>
          
          <textarea
            autoFocus
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-32 p-3 bg-slate-700 text-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none mb-4"
            placeholder="輸入當日提示或備註..."
          />

          <div className="flex justify-between gap-2">
            {initialNote && (
              <Button type="button" variant="danger" size="sm" onClick={handleDelete}>
                刪除
              </Button>
            )}
            <div className="flex-1" />
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>取消</Button>
            <Button type="submit" variant="primary" size="sm">儲存</Button>
          </div>
        </form>
      </div>
    </div>
  );
};