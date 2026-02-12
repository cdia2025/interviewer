
export type NoteColor = 'yellow' | 'blue' | 'green' | 'red' | 'purple';

export interface Interviewer {
  id: string;
  name: string;
  color: string;
  isHidden?: boolean;
}

export interface AvailabilitySlot {
  id: string;
  interviewerId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  isBooked?: boolean;
  originalId?: string; // Used for UI handling when slots are split
}

export interface ParsedSlot {
  interviewerName: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface DayNote {
  date: string; // YYYY-MM-DD
  content: string;
  color?: NoteColor;
}

export interface DayInfo {
  date: Date;
  isCurrentMonth: boolean;
  slots: (AvailabilitySlot & { interviewer: Interviewer })[];
  note?: DayNote;
}