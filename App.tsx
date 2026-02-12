import React, { useState, useEffect, useMemo } from 'react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMinutes,
  parse,
  isValid
} from 'date-fns';
import { AvailabilitySlot, Interviewer, ParsedSlot, DayInfo, DayNote, NoteColor } from './types';
import { INTERVIEWER_COLORS } from './constants';
import { Button } from './components/Button';
import { AIInputModal } from './components/AIInputModal';
import { SlotEditorModal } from './components/SlotEditorModal';
import { NoteEditorModal } from './components/NoteEditorModal';
import { StatisticsModal } from './components/StatisticsModal';
import { BatchAddModal } from './components/BatchAddModal';
import { exportToExcel } from './services/exportService';

const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const NOTE_STYLES: Record<string, string> = {
  yellow: 'bg-yellow-50 text-yellow-800 border-yellow-100',
  blue: 'bg-blue-50 text-blue-800 border-blue-100',
  green: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  red: 'bg-red-50 text-red-800 border-red-100',
  purple: 'bg-purple-50 text-purple-800 border-purple-100',
};

const App: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [interviewers, setInterviewers] = useState<Interviewer[]>([]);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [dayNotes, setDayNotes] = useState<DayNote[]>([]);
  const [selectedInterviewerIds, setSelectedInterviewerIds] = useState<Set<string>>(new Set());
  const [showNames, setShowNames] = useState(true);
  
  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Modals state
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<(AvailabilitySlot & { interviewer: Interviewer }) | undefined>();
  
  // Note Modal state
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [editingNoteDate, setEditingNoteDate] = useState<Date | null>(null);

  // Clipboard State for Notes
  const [clipboardNote, setClipboardNote] = useState<{content: string, color: string} | null>(null);

  // --- API Functions ---
  const fetchData = async (showSyncState = false) => {
    try {
      if (showSyncState) setIsSyncing(true);
      else setIsLoading(true);
      
      const res = await fetch('/api/data');
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      
      const safeSlots = (data.slots || []).map((s: any) => ({
        ...s,
        startTime: s.startTime || '09:00',
        endTime: s.endTime || '09:30',
        isBooked: !!s.isBooked
      }));

      setSlots(safeSlots);
      setInterviewers(data.interviewers || []);
      
      const rawNotes = data.notes || [];
      const validNotes: DayNote[] = rawNotes.map((n: any) => ({
        date: String(n.date),
        content: String(n.content),
        color: (['yellow', 'blue', 'green', 'red', 'purple'].includes(String(n.color)) ? n.color : 'yellow') as NoteColor
      }));
      setDayNotes(validNotes);
      
      if (data.interviewers && selectedInterviewerIds.size === 0) {
        setSelectedInterviewerIds(new Set(data.interviewers.map((i: Interviewer) => i.id)));
      }
    } catch (e) {
      console.error("Fetch Error", e);
    } finally {
      setIsLoading(false);
      setIsSyncing(false);
    }
  };

  const ensureInterviewerExists = async (inv: Interviewer) => {
     try {
       await fetch('/api/interviewers', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(inv)
       });
     } catch (e) {
       console.error("Failed to sync interviewer", e);
     }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAIScheduleConfirm = async (parsedSlots: ParsedSlot[]) => {
    setIsSaving(true);
    let currentInterviewers = [...interviewers];
    const newSlots: AvailabilitySlot[] = [];
    const createdInterviewerIds = new Set<string>();

    for (const ps of parsedSlots) {
      const trimmedName = ps.interviewerName.trim();
      let inv = currentInterviewers.find(i => i.name.toLowerCase() === trimmedName.toLowerCase());

      if (!inv) {
        inv = {
          id: crypto.randomUUID(),
          name: trimmedName,
          color: INTERVIEWER_COLORS[currentInterviewers.length % INTERVIEWER_COLORS.length]
        };
        currentInterviewers.push(inv);
        createdInterviewerIds.add(inv.id);
        await ensureInterviewerExists(inv);
      }

      newSlots.push({
        id: crypto.randomUUID(),
        interviewerId: inv.id,
        date: ps.date,
        startTime: ps.startTime,
        endTime: ps.endTime,
        isBooked: false
      });
    }

    setInterviewers(currentInterviewers);
    setSlots(prev => [...prev, ...newSlots]);
    
    if (createdInterviewerIds.size > 0) {
      setSelectedInterviewerIds(prev => {
        const next = new Set(prev);
        createdInterviewerIds.forEach(id => next.add(id));
        return next;
      });
    }

    try {
       await fetch('/api/slots/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newSlots)
       });
    } catch (e) {
       console.error("Batch save failed", e);
       fetchData();
    } finally {
       setIsSaving(false);
    }
  };

  const handleBatchAdd = async (batchSlots: Partial<AvailabilitySlot>[], interviewerName: string) => {
    setIsSaving(true);
    const trimmedName = interviewerName.trim();
    let inv = interviewers.find(i => i.name.toLowerCase() === trimmedName.toLowerCase());
    
    if (!inv) {
      inv = {
        id: crypto.randomUUID(),
        name: trimmedName,
        color: INTERVIEWER_COLORS[interviewers.length % INTERVIEWER_COLORS.length]
      };
      setInterviewers(prev => [...prev, inv!]);
      await ensureInterviewerExists(inv);
    }

    const finalInvId = inv.id;
    setSelectedInterviewerIds(prev => new Set([...prev, finalInvId]));

    const fullSlots: AvailabilitySlot[] = batchSlots.map(s => ({
      id: crypto.randomUUID(),
      interviewerId: finalInvId,
      date: s.date!,
      startTime: s.startTime!,
      endTime: s.endTime!,
      isBooked: false
    }));

    setSlots(prev => [...prev, ...fullSlots]);

    try {
      await fetch('/api/slots/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullSlots)
      });
    } catch (e) {
      console.error("Batch add failed", e);
      fetchData();
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSlot = async (slotData: Partial<AvailabilitySlot>, interviewerName: string) => {
    setIsSaving(true);
    const trimmedName = interviewerName.trim();
    let inv = interviewers.find(i => i.name.toLowerCase() === trimmedName.toLowerCase());
    
    if (!inv) {
       inv = {
          id: crypto.randomUUID(),
          name: trimmedName,
          color: INTERVIEWER_COLORS[interviewers.length % INTERVIEWER_COLORS.length]
       };
       setInterviewers(prev => [...prev, inv!]);
       await ensureInterviewerExists(inv);
    }

    const finalInvId = inv.id;
    setSelectedInterviewerIds(prev => new Set([...prev, finalInvId]));
    
    try {
      if (slotData.id) {
        const existingSlot = slots.find(s => s.id === slotData.id);
        const updatedSlot = { ...existingSlot, ...slotData, interviewerId: finalInvId } as AvailabilitySlot;
        setSlots(prev => prev.map(s => s.id === slotData.id ? updatedSlot : s));
        await fetch(`/api/slots/${updatedSlot.id}`, {
           method: 'PUT',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify(updatedSlot)
        });
      } else {
        const newSlot: AvailabilitySlot = {
          id: crypto.randomUUID(),
          interviewerId: finalInvId,
          date: slotData.date!,
          startTime: slotData.startTime!,
          endTime: slotData.endTime!,
          isBooked: slotData.isBooked || false
        };
        setSlots(prev => [...prev, newSlot]);
        await fetch('/api/slots', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify(newSlot)
        });
      }
    } catch (e) {
      console.error("Save slot error", e);
      fetchData();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSlot = async (id: string) => {
    setIsSaving(true);
    setSlots(prev => prev.filter(s => s.id !== id));
    setIsEditorOpen(false);
    try {
       await fetch(`/api/slots/${id}`, { method: 'DELETE' });
    } catch (e) {
      console.error("Delete failed", e);
      fetchData();
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveNote = async (date: string, content: string, color: NoteColor = 'yellow') => {
    setIsSaving(true);
    const newNote: DayNote = { date, content, color };
    setDayNotes(prev => {
        const filtered = prev.filter(n => n.date !== date);
        return content.trim() ? [...filtered, newNote] : filtered;
    });
    try {
      await fetch('/api/notes', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(newNote)
      });
    } catch (e) {
      fetchData();
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyNote = (e: React.MouseEvent, note: DayNote) => {
    e.stopPropagation();
    setClipboardNote({ content: note.content, color: note.color || 'yellow' });
  };

  const handlePasteNote = (date: Date) => {
    if (clipboardNote) {
      const dateStr = format(date, 'yyyy-MM-dd');
      handleSaveNote(dateStr, clipboardNote.content, clipboardNote.color as NoteColor);
    }
  };

  const handleDeleteNote = async (date: string) => {
    setIsSaving(true);
    setDayNotes(prev => prev.filter(n => n.date !== date));
    try {
      await fetch(`/api/notes/${date}`, { method: 'DELETE' });
    } catch (e) {
      fetchData();
    } finally {
      setIsSaving(false);
    }
  };

  const toggleInterviewerFilter = (id: string) => {
    setSelectedInterviewerIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const uniqueInterviewersForDisplay = useMemo(() => {
    const seen = new Set();
    const activeIds = new Set<string>();
    slots.forEach(s => {
      const sDate = parse(s.date, 'yyyy-MM-dd', new Date());
      if (isValid(sDate) && isSameMonth(sDate, currentDate)) activeIds.add(s.interviewerId);
    });
    return interviewers.filter(inv => {
      if (!activeIds.has(inv.id)) return false;
      const lowerName = inv.name.toLowerCase().trim();
      if (seen.has(lowerName)) return false;
      seen.add(lowerName);
      return true;
    });
  }, [interviewers, slots, currentDate]);

  const splitSlotsForDisplay = (daySlots: (AvailabilitySlot & { interviewer: Interviewer })[]) => {
    const result: (AvailabilitySlot & { interviewer: Interviewer })[] = [];
    daySlots.forEach(slot => {
      const startTime = parse(slot.startTime, 'HH:mm', new Date());
      const endTime = parse(slot.endTime, 'HH:mm', new Date());
      if (!isValid(startTime) || !isValid(endTime)) {
        result.push(slot);
        return;
      }
      let current = startTime;
      while (current < endTime) {
        const next = addMinutes(current, 30);
        if (next > endTime) break;
        result.push({
          ...slot,
          originalId: slot.id, 
          id: `${slot.id}__${format(current, 'HHmm')}`, 
          startTime: format(current, 'HH:mm'),
          endTime: format(next, 'HH:mm'),
        });
        current = next;
      }
    });
    return result;
  };

  const calendarDays: DayInfo[] = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);
    return eachDayOfInterval({ start: startDate, end: endDate }).map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const daySlotsRaw = slots
        .filter(s => s.date === dateStr && selectedInterviewerIds.has(s.interviewerId))
        .map(s => {
           const inv = interviewers.find(i => i.id === s.interviewerId);
           return inv ? { ...s, interviewer: inv } : null;
        })
        .filter((s): s is (AvailabilitySlot & { interviewer: Interviewer }) => s !== null);

      return { 
        date, 
        isCurrentMonth: isSameMonth(date, monthStart), 
        slots: splitSlotsForDisplay(daySlotsRaw), 
        note: dayNotes.find(n => n.date === dateStr) 
      };
    });
  }, [currentDate, slots, interviewers, selectedInterviewerIds, dayNotes]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">正在載入排程資料...</div>;
  }

  return (
    <div className="min-h-screen flex flex-col font-tc">
      <header className="no-print bg-white border-b border-gray-200 sticky top-0 z-30 px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
          </div>
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-blue-500">面試排程助理</h1>
        </div>
        
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => fetchData(true)} isLoading={isSyncing} className="border border-gray-200">
            同步
          </Button>
          <Button variant="secondary" onClick={() => exportToExcel(currentDate, slots, interviewers, dayNotes)}>
            Excel
          </Button>
          <Button variant="secondary" onClick={() => setIsStatsModalOpen(true)}>
             統計
          </Button>
          <div className="h-8 w-[1px] bg-gray-200 mx-1 hidden md:block"></div>
          <Button variant="success" onClick={() => setIsBatchModalOpen(true)}>
             批量新增
          </Button>
          <Button variant="success" onClick={() => { setEditingSlot(undefined); setIsEditorOpen(true); }}>
             新增單筆
          </Button>
          <Button variant="primary" onClick={() => setIsAIModalOpen(true)}>
            AI 輸入
          </Button>
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <aside className="no-print w-full md:w-64 bg-gray-50 border-r border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase">面試員 ({uniqueInterviewersForDisplay.length})</h3>
            <button onClick={() => setShowNames(!showNames)} className="text-[10px] bg-gray-200 px-2 py-0.5 rounded-full">{showNames ? '隱藏' : '顯示'}</button>
          </div>
          <div className="space-y-1">
            {uniqueInterviewersForDisplay.map(inv => (
              <button key={inv.id} onClick={() => toggleInterviewerFilter(inv.id)} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${selectedInterviewerIds.has(inv.id) ? 'bg-white shadow-sm font-semibold' : 'text-gray-500'}`}>
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: inv.color }} />
                <span className="flex-1 text-left">{inv.name}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="flex-1 overflow-auto bg-gray-50 p-4 md:p-8">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-3xl font-bold text-gray-800">{format(currentDate, 'yyyy年 MMMM')}</h2>
              <div className="no-print flex bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="p-2 border-r hover:bg-gray-50">上月</button>
                <button onClick={() => setCurrentDate(new Date())} className="px-4 py-2 text-sm hover:bg-gray-50">今天</button>
                <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="p-2 border-l hover:bg-gray-50">下月</button>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="grid grid-cols-7 border-b bg-gray-50">
                {['日', '一', '二', '三', '四', '五', '六'].map(day => (
                  <div key={day} className="py-3 text-center text-xs font-bold text-gray-400 uppercase">星期{day}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {calendarDays.map((day, idx) => (
                  <div key={idx} className={`min-h-[140px] border-r border-b p-2 flex flex-col gap-1 group/cell ${!day.isCurrentMonth ? 'bg-gray-50/50 opacity-40' : ''}`}>
                    <div className="flex justify-between items-start">
                      <span className={`text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full ${isSameDay(day.date, new Date()) ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>
                        {format(day.date, 'd')}
                      </span>
                      <div className="flex gap-1 opacity-0 group-hover/cell:opacity-100">
                        {clipboardNote && <button onClick={() => handlePasteNote(day.date)} className="text-gray-300 hover:text-green-500">貼上</button>}
                        <button onClick={() => { setEditingNoteDate(day.date); setIsNoteModalOpen(true); }} className="text-gray-300 hover:text-blue-500">備註</button>
                      </div>
                    </div>
                    {day.note && <div onClick={() => { setEditingNoteDate(day.date); setIsNoteModalOpen(true); }} className={`text-xs p-1.5 rounded border ${NOTE_STYLES[day.note.color || 'yellow']} cursor-pointer`}>{day.note.content}</div>}
                    <div className="flex-1 flex flex-wrap gap-1 content-start overflow-y-auto max-h-40">
                      {day.slots.map(slot => (
                        <div key={slot.id} onClick={() => { setEditingSlot(slot); setIsEditorOpen(true); }} style={{ borderLeftColor: slot.interviewer.color, backgroundColor: slot.isBooked ? '#f3f4f6' : hexToRgba(slot.interviewer.color, 0.1) }} className="text-[10px] p-1 rounded-r border-l-[3px] shadow-sm cursor-pointer hover:shadow flex-grow basis-[calc(100%)] xl:basis-[calc(50%-4px)]">
                          <div className="font-bold truncate">{showNames ? slot.interviewer.name : ''}</div>
                          <div className="text-gray-500">{slot.startTime} {slot.isBooked ? '(已約)' : ''}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>

      <AIInputModal isOpen={isAIModalOpen} onClose={() => setIsAIModalOpen(false)} onConfirm={handleAIScheduleConfirm} />
      <SlotEditorModal isOpen={isEditorOpen} onClose={() => setIsEditorOpen(false)} onSave={handleSaveSlot} onDelete={handleDeleteSlot} initialSlot={editingSlot} />
      <NoteEditorModal isOpen={isNoteModalOpen} onClose={() => setIsNoteModalOpen(false)} onSave={handleSaveNote} onDelete={handleDeleteNote} date={editingNoteDate} initialNote={editingNoteDate ? dayNotes.find(n => n.date === format(editingNoteDate, 'yyyy-MM-dd')) : undefined} />
      <StatisticsModal isOpen={isStatsModalOpen} onClose={() => setIsStatsModalOpen(false)} slots={slots} interviewers={interviewers} currentDate={currentDate} />
      <BatchAddModal isOpen={isBatchModalOpen} onClose={() => setIsBatchModalOpen(false)} onConfirm={handleBatchAdd} interviewers={interviewers} />
    </div>
  );
};

export default App;