import React, { useState, useEffect, useMemo, useRef } from 'react';
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

const NOTE_BTN_STYLES: Record<string, string> = {
  yellow: 'bg-yellow-100 text-yellow-700',
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-emerald-100 text-emerald-700',
  red: 'bg-red-100 text-red-700',
  purple: 'bg-purple-100 text-purple-700',
};

const App: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [interviewers, setInterviewers] = useState<Interviewer[]>([]);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [dayNotes, setDayNotes] = useState<DayNote[]>([]);
  const [selectedInterviewerIds, setSelectedInterviewerIds] = useState<Set<string>>(new Set());
  const [showNames, setShowNames] = useState(true);
  const [clipboardNote, setClipboardNote] = useState<DayNote | null>(null);
  
  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const calendarRef = useRef<HTMLDivElement>(null);

  // Modals state
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<(AvailabilitySlot & { interviewer: Interviewer }) | undefined>();
  
  // Note Modal state
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [editingNoteDate, setEditingNoteDate] = useState<Date | null>(null);

  // --- API Functions ---
  const fetchData = async (showSyncState = false) => {
    try {
      if (showSyncState) setIsSyncing(true);
      else setIsLoading(true);
      
      const res = await fetch('/api/data');
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      
      setSlots(data.slots || []);
      setInterviewers(data.interviewers || []);
      
      // Sanitizing notes data - ensure color is valid NoteColor
      const validNotes = (data.notes || []).map((n: any) => ({
         ...n,
         color: (['yellow', 'blue', 'green', 'red', 'purple'].includes(n.color) ? n.color : 'yellow') as NoteColor
      }));
      setDayNotes(validNotes);
      
      // Keep existing selection if possible, or initialize
      if (data.interviewers && selectedInterviewerIds.size === 0) {
        setSelectedInterviewerIds(new Set(data.interviewers.map((i: Interviewer) => i.id)));
      }
    } catch (e) {
      console.error("Fetch Error", e);
      alert("無法從伺服器獲取資料，請確認網路連線或 Google Sheets 設定。");
    } finally {
      setIsLoading(false);
      setIsSyncing(false);
    }
  };

  const saveData = async (newSlots: AvailabilitySlot[], newInv: Interviewer[], newNotes: DayNote[]) => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots: newSlots, interviewers: newInv, notes: newNotes })
      });
      if (!res.ok) throw new Error("Sync failed");
    } catch (e) {
      console.error("Save Error", e);
      alert("儲存至 Google Sheets 失敗，請手動刷新頁面檢查資料一致性。");
    } finally {
      setIsSaving(false);
    }
  };

  // Initial Load
  useEffect(() => {
    fetchData();
  }, []);

  // Update wrapper that updates state AND calls API
  const updateData = (
    updatedSlots: AvailabilitySlot[] | ((prev: AvailabilitySlot[]) => AvailabilitySlot[]),
    updatedInv: Interviewer[] | ((prev: Interviewer[]) => Interviewer[]) = interviewers,
    updatedNotes: DayNote[] | ((prev: DayNote[]) => DayNote[]) = dayNotes
  ) => {
    let nextSlots = typeof updatedSlots === 'function' ? updatedSlots(slots) : updatedSlots;
    let nextInv = typeof updatedInv === 'function' ? updatedInv(interviewers) : updatedInv;
    let nextNotes = typeof updatedNotes === 'function' ? updatedNotes(dayNotes) : updatedNotes;

    setSlots(nextSlots);
    setInterviewers(nextInv);
    setDayNotes(nextNotes);

    saveData(nextSlots, nextInv, nextNotes);
  };

  const timeToMins = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const handleAIScheduleConfirm = (parsedSlots: ParsedSlot[]) => {
    let currentInterviewers = [...interviewers];
    const newSlots: AvailabilitySlot[] = [];
    const createdInterviewerIds = new Set<string>();

    parsedSlots.forEach(ps => {
      const rawName = ps.interviewerName;
      const trimmedName = rawName.trim();
      
      let inv = currentInterviewers.find(i => i.name.toLowerCase() === trimmedName.toLowerCase());

      if (!inv) {
        inv = {
          id: crypto.randomUUID(),
          name: trimmedName,
          color: INTERVIEWER_COLORS[currentInterviewers.length % INTERVIEWER_COLORS.length]
        };
        currentInterviewers.push(inv);
        createdInterviewerIds.add(inv.id);
      }

      newSlots.push({
        id: crypto.randomUUID(),
        interviewerId: inv.id,
        date: ps.date,
        startTime: ps.startTime,
        endTime: ps.endTime,
        isBooked: false
      });
    });

    const finalSlots = [...slots, ...newSlots];
    updateData(finalSlots, currentInterviewers);
    
    if (createdInterviewerIds.size > 0) {
      setSelectedInterviewerIds(prev => {
        const next = new Set(prev);
        createdInterviewerIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const handleSaveSlot = (slotData: Partial<AvailabilitySlot>, interviewerName: string) => {
    const trimmedName = interviewerName.trim();
    let inv = interviewers.find(i => i.name.toLowerCase() === trimmedName.toLowerCase());
    let nextInterviewers = [...interviewers];

    if (!inv) {
       inv = {
          id: crypto.randomUUID(),
          name: trimmedName,
          color: INTERVIEWER_COLORS[interviewers.length % INTERVIEWER_COLORS.length]
       };
       nextInterviewers.push(inv);
       setSelectedInterviewerIds(prev => new Set([...prev, inv!.id]));
    }
    
    let nextSlots = [...slots];

    if (slotData.id) {
      const existingSlot = slots.find(s => s.id === slotData.id);
      
      if (existingSlot) {
        if (existingSlot.startTime !== slotData.startTime || existingSlot.endTime !== slotData.endTime) {
          const oldStart = timeToMins(existingSlot.startTime);
          const oldEnd = timeToMins(existingSlot.endTime);
          const newStart = timeToMins(slotData.startTime!);
          const newEnd = timeToMins(slotData.endTime!);

          if (newStart >= oldStart && newEnd <= oldEnd) {
             const newSlotsToAdd: AvailabilitySlot[] = [];
             if (newStart > oldStart) {
               newSlotsToAdd.push({ ...existingSlot, id: crypto.randomUUID(), endTime: slotData.startTime! });
             }
             newSlotsToAdd.push({ ...existingSlot, id: crypto.randomUUID(), startTime: slotData.startTime!, endTime: slotData.endTime!, isBooked: slotData.isBooked, interviewerId: inv.id });
             if (newEnd < oldEnd) {
               newSlotsToAdd.push({ ...existingSlot, id: crypto.randomUUID(), startTime: slotData.endTime! });
             }
             nextSlots = nextSlots.filter(s => s.id !== slotData.id).concat(newSlotsToAdd);
          } else {
             nextSlots = nextSlots.map(s => s.id === slotData.id ? { ...s, ...slotData, interviewerId: inv!.id } as AvailabilitySlot : s);
          }
        } else {
          nextSlots = nextSlots.map(s => s.id === slotData.id ? { ...s, ...slotData, interviewerId: inv!.id } as AvailabilitySlot : s);
        }
      }
    } else {
      const newSlot: AvailabilitySlot = {
        id: crypto.randomUUID(),
        interviewerId: inv.id,
        date: slotData.date!,
        startTime: slotData.startTime!,
        endTime: slotData.endTime!,
        isBooked: slotData.isBooked || false
      };
      nextSlots.push(newSlot);
    }
    updateData(nextSlots, nextInterviewers);
  };

  const handleDeleteSlot = (id: string, isSplitRequest?: boolean) => {
    let nextSlots = [...slots];
    if (editingSlot && isSplitRequest) {
       const existingSlot = slots.find(s => s.id === id);
       if (existingSlot) {
          const oldStart = timeToMins(existingSlot.startTime);
          const oldEnd = timeToMins(existingSlot.endTime);
          const targetStart = timeToMins(editingSlot.startTime);
          const targetEnd = timeToMins(editingSlot.endTime);
          if (targetStart >= oldStart && targetEnd <= oldEnd) {
             const newSlotsToAdd: AvailabilitySlot[] = [];
             if (targetStart > oldStart) newSlotsToAdd.push({ ...existingSlot, id: crypto.randomUUID(), endTime: editingSlot.startTime });
             if (targetEnd < oldEnd) newSlotsToAdd.push({ ...existingSlot, id: crypto.randomUUID(), startTime: editingSlot.endTime });
             nextSlots = nextSlots.filter(s => s.id !== id).concat(newSlotsToAdd);
          }
       }
    } else {
       nextSlots = nextSlots.filter(s => s.id !== id);
    }
    updateData(nextSlots);
    setIsEditorOpen(false);
  };

  const handleSaveNote = (date: string, content: string, color: NoteColor = 'yellow') => {
    const nextNotes = dayNotes.filter(n => n.date !== date);
    if (content.trim()) nextNotes.push({ date, content, color });
    updateData(slots, interviewers, nextNotes);
  };

  const handleDeleteNote = (date: string) => {
    const nextNotes = dayNotes.filter(n => n.date !== date);
    updateData(slots, interviewers, nextNotes);
  };

  const openNoteEditor = (date: Date) => {
    setEditingNoteDate(date);
    setIsNoteModalOpen(true);
  };

  const copyNote = (note: DayNote) => setClipboardNote(note);

  const pasteNote = (date: Date) => {
    if (clipboardNote) {
      const validColors: NoteColor[] = ['yellow', 'blue', 'green', 'red', 'purple'];
      const rawColor = clipboardNote.color;
      
      const noteColor: NoteColor = (rawColor && validColors.includes(rawColor as NoteColor)) 
        ? (rawColor as NoteColor) 
        : 'yellow';
      
      handleSaveNote(format(date, 'yyyy-MM-dd'), clipboardNote.content, noteColor);
    }
  };

  const getNoteForDate = (date: Date) => dayNotes.find(n => n.date === format(date, 'yyyy-MM-dd'));

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
        .map(s => ({
          ...s,
          interviewer: interviewers.find(i => i.id === s.interviewerId)!
        }))
        .filter(s => !!s.interviewer);
      const displayedSlots = splitSlotsForDisplay(daySlotsRaw);
      return { date, isCurrentMonth: isSameMonth(date, monthStart), slots: displayedSlots, note: dayNotes.find(n => n.date === dateStr) };
    });
  }, [currentDate, slots, interviewers, selectedInterviewerIds, dayNotes]);

  const handleExportPDF = () => {
    if (!calendarRef.current) return;
    const originalElement = calendarRef.current;
    const clone = originalElement.cloneNode(true) as HTMLElement;
    clone.style.width = '1100px'; 
    clone.style.height = 'auto'; 
    clone.style.maxHeight = 'none';
    clone.style.overflow = 'visible';
    clone.style.background = 'white';
    clone.style.padding = '20px';
    const scrollables = clone.querySelectorAll('.overflow-y-auto');
    scrollables.forEach((el) => {
      (el as HTMLElement).style.maxHeight = 'none';
      (el as HTMLElement).style.overflow = 'visible';
    });
    const slotEls = clone.querySelectorAll('.text-\\[10px\\]');
    slotEls.forEach((el) => {
      (el as HTMLElement).style.fontSize = '8px';
      (el as HTMLElement).style.lineHeight = '1';
    });
    const cells = clone.querySelectorAll('.min-h-\\[140px\\]');
    cells.forEach((el) => {
      (el as HTMLElement).style.minHeight = '100px'; 
      (el as HTMLElement).classList.remove('min-h-[140px]');
    });
    const container = document.createElement('div');
    container.style.position = 'fixed'; container.style.top = '-10000px'; container.style.left = '0'; container.style.zIndex = '-1000';
    container.appendChild(clone);
    document.body.appendChild(container);
    const opt = {
      margin: 5, filename: `Interview_Schedule_${format(currentDate, 'yyyy_MM')}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, scrollY: 0, windowWidth: 1150 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] } 
    };
    // @ts-ignore
    window.html2pdf().set(opt).from(clone).save().then(() => {
      document.body.removeChild(container);
    });
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">正在從 Google Sheets 載入資料...</div>;
  }

  return (
    <div className="min-h-screen flex flex-col font-tc">
      <header className="no-print bg-white border-b border-gray-200 sticky top-0 z-30 px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
          </div>
          <div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-blue-500">面試排程助理</h1>
            {isSaving && <span className="text-[10px] text-blue-400 animate-pulse font-medium">雲端儲存中...</span>}
          </div>
        </div>
        
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => fetchData(true)} isLoading={isSyncing} className="border border-gray-200">
            <svg className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357-2H15"></path></svg>
            同步最新資料
          </Button>
          <Button variant="secondary" onClick={() => exportToExcel(currentDate, slots, interviewers, dayNotes)}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M7 10l5 5m0 0l5-5m-5 5V3"></path></svg>
            Excel
          </Button>
          <Button variant="secondary" onClick={handleExportPDF}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
            PDF
          </Button>
          <Button variant="secondary" onClick={() => setIsStatsModalOpen(true)}>
             <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
             統計
          </Button>
          <div className="h-8 w-[1px] bg-gray-200 mx-1 self-center hidden md:block"></div>
          <Button variant="primary" onClick={() => setIsAIModalOpen(true)}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            AI 智能輸入
          </Button>
          <Button variant="success" onClick={() => { setEditingSlot(undefined); setIsEditorOpen(true); }}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
            手動新增
          </Button>
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <aside className="no-print w-full md:w-64 bg-gray-50 border-r border-gray-200 p-6 flex flex-col gap-6">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">本月面試員 ({uniqueInterviewersForDisplay.length})</h3>
              <button 
                onClick={() => setShowNames(!showNames)}
                className="text-[10px] bg-gray-200 px-2 py-0.5 rounded-full hover:bg-gray-300 transition-colors"
              >
                {showNames ? '隱藏名稱' : '顯示名稱'}
              </button>
            </div>
            <div className="space-y-1">
              {uniqueInterviewersForDisplay.map(inv => (
                <button
                  key={inv.id}
                  onClick={() => toggleInterviewerFilter(inv.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm ${
                    selectedInterviewerIds.has(inv.id) ? 'bg-white shadow-sm' : 'hover:bg-gray-100'
                  }`}
                >
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: inv.color }} />
                  <span className={`flex-1 text-left ${selectedInterviewerIds.has(inv.id) ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                    {inv.name}
                  </span>
                  {selectedInterviewerIds.has(inv.id) && (
                    <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"></path></svg>
                  )}
                </button>
              ))}
              {uniqueInterviewersForDisplay.length === 0 && <p className="text-sm text-gray-400 italic">本月暫無面試資料</p>}
            </div>
          </div>
          
          <div className="mt-auto pt-6 border-t border-gray-200">
            <div className="text-[11px] text-gray-400 space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full border border-gray-300 bg-white" /> <span>可面試</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-gray-200 ring-1 ring-gray-400" /> <span>已預約</span>
              </div>
              {clipboardNote && (
                <div className={`mt-2 p-2 rounded border text-xs ${NOTE_STYLES[clipboardNote.color || 'yellow'].replace('bg-yellow-50', 'bg-blue-50').replace('text-yellow-800', 'text-blue-700').replace('border-yellow-100', 'border-blue-200')}`}>
                   已複製備註，可貼上
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-auto bg-gray-50 p-4 md:p-8">
          <div ref={calendarRef} className="max-w-6xl mx-auto space-y-6 bg-gray-50 p-4 rounded-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-3xl font-bold text-gray-800">{format(currentDate, 'yyyy年 MMMM')}</h2>
              <div className="no-print flex bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="p-2 hover:bg-gray-50 border-r border-gray-200">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                </button>
                <button onClick={() => setCurrentDate(new Date())} className="px-4 py-2 text-sm font-medium hover:bg-gray-50">返回今天</button>
                <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="p-2 hover:bg-gray-50 border-l border-gray-200">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50">
                {['日', '一', '二', '三', '四', '五', '六'].map(day => (
                  <div key={day} className="py-3 text-center text-xs font-bold text-gray-400 uppercase tracking-widest">星期{day}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {calendarDays.map((day, idx) => (
                  <div
                    key={idx}
                    className={`min-h-[140px] border-r border-b border-gray-100 p-2 flex flex-col gap-1 transition-colors hover:bg-gray-50/50 relative group/cell ${
                      !day.isCurrentMonth ? 'bg-gray-50/50 opacity-40' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className={`text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full ${
                        isSameDay(day.date, new Date()) ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400'
                      }`}>
                        {format(day.date, 'd')}
                      </span>
                      
                      <div className="flex gap-1 opacity-0 group-hover/cell:opacity-100 transition-opacity">
                         {clipboardNote && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); pasteNote(day.date); }}
                              className="text-gray-300 hover:text-green-500 p-1"
                              title="貼上備註"
                            >
                               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                            </button>
                         )}
                         <button 
                           onClick={(e) => { e.stopPropagation(); openNoteEditor(day.date); }}
                           className={`p-1 rounded ${day.note ? 'text-blue-500 opacity-100' : 'text-gray-300 hover:text-blue-500'}`}
                           title="編輯備註"
                         >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                         </button>
                      </div>
                    </div>

                    {day.note && (
                      <div 
                        onClick={(e) => { e.stopPropagation(); openNoteEditor(day.date); }}
                        className={`group/note relative mb-2 text-xs p-1.5 rounded border break-words whitespace-pre-wrap cursor-pointer hover:shadow-sm transition-shadow ${NOTE_STYLES[day.note.color || 'yellow']}`}
                      >
                        {day.note.content}
                        <button 
                          onClick={(e) => { e.stopPropagation(); copyNote(day.note!); }}
                          className={`absolute top-0.5 right-0.5 opacity-0 group-hover/note:opacity-100 p-0.5 rounded ${NOTE_BTN_STYLES[day.note.color || 'yellow']}`}
                          title="複製"
                        >
                           <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
                        </button>
                      </div>
                    )}

                    <div className="flex-1 flex flex-col gap-1 overflow-y-auto max-h-48">
                      {day.slots.map(slot => (
                        <div
                          key={slot.id}
                          onClick={(e) => { 
                            e.stopPropagation();
                            const realId = slot.originalId || slot.id.split('__')[0];
                            const originalSlot = slots.find(s => s.id === realId);
                            if (originalSlot) {
                              setEditingSlot({ ...originalSlot, startTime: slot.startTime, endTime: slot.endTime, id: realId, interviewer: slot.interviewer }); 
                              setIsEditorOpen(true); 
                            }
                          }}
                          style={{ borderLeftColor: slot.interviewer.color, backgroundColor: slot.isBooked ? '#f3f4f6' : hexToRgba(slot.interviewer.color, 0.1), opacity: slot.isBooked ? 0.7 : 1 }}
                          className={`text-[10px] leading-tight p-1 rounded-r border-l-[3px] shadow-sm ring-1 ring-black/5 cursor-pointer hover:shadow transition-all group ${slot.isBooked ? 'grayscale-[0.5]' : ''}`}
                        >
                          <div className="flex justify-between items-start">
                            {showNames && <div className={`font-bold truncate ${slot.isBooked ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{slot.interviewer.name}</div>}
                            {slot.isBooked && <span className="bg-gray-200 text-gray-600 px-1 rounded text-[8px] uppercase font-bold">已預約</span>}
                          </div>
                          <div className="text-gray-500 font-medium">{slot.startTime}</div>
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
      <SlotEditorModal isOpen={isEditorOpen} onClose={() => { setIsEditorOpen(false); setEditingSlot(undefined); }} onSave={handleSaveSlot} onDelete={handleDeleteSlot} initialSlot={editingSlot} />
      <NoteEditorModal isOpen={isNoteModalOpen} onClose={() => setIsNoteModalOpen(false)} onSave={handleSaveNote} onDelete={handleDeleteNote} date={editingNoteDate} initialNote={editingNoteDate ? getNoteForDate(editingNoteDate) : undefined} />
      <StatisticsModal isOpen={isStatsModalOpen} onClose={() => setIsStatsModalOpen(false)} slots={slots} interviewers={interviewers} currentDate={currentDate} />
    </div>
  );
};

export default App;