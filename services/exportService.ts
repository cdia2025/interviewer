import * as XLSX from 'xlsx';
import { AvailabilitySlot, Interviewer, DayNote } from '../types';
import { format, eachDayOfInterval, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameMonth } from 'date-fns';
import { generateTimeSlots } from '../constants';

export const exportToExcel = (
  month: Date,
  slots: AvailabilitySlot[],
  interviewers: Interviewer[],
  notes: DayNote[]
) => {
  const workbook = XLSX.utils.book_new();
  const timeSlots = generateTimeSlots();
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  
  // --- Sheet 1: Calendar View (Visual Layout) ---
  const calendarSheetData: any[][] = [];
  
  // Title Row
  calendarSheetData.push([`${format(month, 'yyyy-MM')} 面試排程表`]);
  calendarSheetData.push([]); 

  // Weekday Headers
  const daysOfWeek = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  calendarSheetData.push(daysOfWeek);

  // Generate Calendar Days
  const calendarStartDate = startOfWeek(monthStart);
  const calendarEndDate = endOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: calendarStartDate, end: calendarEndDate });

  let currentWeekCells: string[] = [];
  
  calendarDays.forEach((day, index) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const dayLabel = format(day, 'd');
    const isCurrent = isSameMonth(day, month);
    
    // Note
    const note = notes.find(n => n.date === dateStr)?.content || '';
    
    // Slots
    const daySlots = slots
      .filter(s => s.date === dateStr)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    // Construct Cell Content
    let lines = [];
    lines.push(isCurrent ? `[${dayLabel}]` : `(${format(day, 'M/d')})`);
    
    if (note) {
      lines.push(`備註: ${note}`);
      lines.push('----------------');
    }
    
    if (daySlots.length > 0) {
      daySlots.forEach(s => {
        const inv = interviewers.find(i => i.id === s.interviewerId);
        const invName = inv ? inv.name : '未知';
        const booked = s.isBooked ? ' [已預約]' : ' [可面試]';
        lines.push(`${s.startTime}-${s.endTime} ${invName}${booked}`);
      });
    } else {
       lines.push('\n\n\n');
    }

    currentWeekCells.push(lines.join('\n'));

    // End of week?
    if ((index + 1) % 7 === 0) {
      calendarSheetData.push(currentWeekCells);
      calendarSheetData.push([]); // Empty row for visual spacing between weeks
      currentWeekCells = [];
    }
  });

  const calendarSheet = XLSX.utils.aoa_to_sheet(calendarSheetData);
  const wscols = daysOfWeek.map(() => ({ wch: 35 }));
  calendarSheet['!cols'] = wscols;

  XLSX.utils.book_append_sheet(workbook, calendarSheet, '日曆視圖');

  // --- Sheet 2: Timeline (時間軸) ---
  const summaryData: any[] = [];
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  
  // Date Headers
  const headerRow = ['時間', ...monthDays.map(d => format(d, 'MM/dd'))];
  summaryData.push(headerRow);

  timeSlots.forEach(time => {
    const row = [time];
    monthDays.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const activeSlots = slots.filter(s => {
        if (s.date !== dateStr) return false;
        // Check if current time row falls within the slot
        return s.startTime <= time && s.endTime > time;
      });
      
      const statusInfo = activeSlots.map(s => {
        const inv = interviewers.find(i => i.id === s.interviewerId);
        const name = inv ? inv.name : '未知';
        const status = s.isBooked ? '已預約' : '可面試';
        return `${name}(${status})`;
      });
      
      row.push(statusInfo.join(', '));
    });
    summaryData.push(row);
  });

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  // Set widths for timeline sheet
  const timelineCols = [{ wch: 10 }, ...monthDays.map(() => ({ wch: 20 }))];
  summarySheet['!cols'] = timelineCols;
  
  XLSX.utils.book_append_sheet(workbook, summarySheet, '時間軸總覽');

  // --- Sheet 3: Raw Data (原始資料) ---
  const rawData = slots.map(s => {
    const inv = interviewers.find(i => i.id === s.interviewerId);
    return {
      '面試員': inv?.name || '未知',
      '日期': s.date,
      '開始時間': s.startTime,
      '結束時間': s.endTime,
      '狀態': s.isBooked ? '已預約' : '可面試'
    };
  });
  const rawSheet = XLSX.utils.json_to_sheet(rawData);
  XLSX.utils.book_append_sheet(workbook, rawSheet, '原始清單');

  // Trigger Download
  XLSX.writeFile(workbook, `面試排程表_${format(month, 'yyyy_MM')}.xlsx`);
};