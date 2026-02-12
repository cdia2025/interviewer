
import React, { useState } from 'react';
import { Button } from './Button';
import { parseSchedulingText } from '../services/geminiService';
import { ParsedSlot } from '../types';

interface AIInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (slots: ParsedSlot[]) => void;
}

export const AIInputModal: React.FC<AIInputModalProps> = ({ isOpen, onClose, onConfirm }) => {
  const [text, setText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parsedResults, setParsedResults] = useState<ParsedSlot[] | null>(null);

  if (!isOpen) return null;

  const handleParse = async () => {
    if (!text.trim()) return;
    setIsParsing(true);
    try {
      const results = await parseSchedulingText(text);
      setParsedResults(results);
    } catch (err) {
      alert("Error parsing text. Please try a different format.");
    } finally {
      setIsParsing(false);
    }
  };

  const handleConfirm = () => {
    if (parsedResults) {
      onConfirm(parsedResults);
      setParsedResults(null);
      setText('');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800">AI Quick Schedule (智能排程)</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {!parsedResults ? (
            <>
              <p className="text-sm text-gray-500">
                請輸入面試時段細節。例如：
                <br />
                <code className="bg-gray-100 px-1 rounded">"陳先生：5月12日 10am-2pm, 李小姐：6月5日 9:00-11:30"</code>
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="輸入文字細節..."
                className="w-full h-40 p-4 bg-slate-800 text-white rounded-xl focus:ring-4 focus:ring-blue-500/30 border-none outline-none resize-none font-medium placeholder-slate-400"
              />
              <div className="flex justify-end gap-3">
                <Button variant="ghost" onClick={onClose}>取消</Button>
                <Button variant="primary" onClick={handleParse} isLoading={isParsing}>開始分析 (AI 解析)</Button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <h3 className="font-semibold text-gray-700">解析結果確認 (按確認匯入)</h3>
              <div className="max-h-60 overflow-y-auto space-y-2 border rounded-lg p-4 bg-gray-50">
                {parsedResults.map((slot, idx) => (
                  <div key={idx} className="flex justify-between items-center p-2 bg-white rounded shadow-sm border border-gray-100">
                    <div>
                      <span className="font-medium text-blue-600">{slot.interviewerName}</span>
                      <span className="mx-2 text-gray-400">|</span>
                      <span className="text-gray-600">{slot.date}</span>
                    </div>
                    <div className="text-sm text-gray-500">
                      {slot.startTime} - {slot.endTime}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button variant="secondary" onClick={() => setParsedResults(null)}>重新編輯</Button>
                <Button variant="success" onClick={handleConfirm}>執行匯入</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
