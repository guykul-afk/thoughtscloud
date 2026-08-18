import { useState, useRef } from 'react';
import { Notebook, Mic, Square, X, Send, Loader2 } from 'lucide-react';
import { useAppStore } from '../store';
import { processAudioSession, processTextSession, generateClarifyingQuestion } from '../services/ai';
import type { LiveChatStatus } from '../services/live-ai';
import VoicePulse from './VoicePulse';
import { cn } from '../App';

interface HomeTabProps {
  isLiveActive: boolean;
  liveStatus: LiveChatStatus;
  liveTranscript: string;
  isRecording: boolean;
  setIsRecording: (val: boolean) => void;
  handleToggleVoice: (instruction?: string) => void;
}

export default function HomeTab({ 
  isLiveActive, liveStatus, liveTranscript, isRecording, setIsRecording, handleToggleVoice
}: HomeTabProps) {
  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [isProcessingText, setIsProcessingText] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [sessionTranscript, setSessionTranscript] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const { apiKey, addEntry, entries } = useAppStore();
  const [recordingTime, setRecordingTime] = useState(0);
  const timerIntervalRef = useRef<number | null>(null);

  const startRecording = async () => {
    console.log("TRACE: startRecording (STAGE 1: Intent Received)");
    try {
      if (isRecording) {
        console.warn("TRACE: startRecording aborted - already recording.");
        return;
      }
      setIsRecording(true);
      console.log("TRACE: startRecording (STAGE 2: UI State Set)");
      const getUserMediaWithTimeout = (constraints: MediaStreamConstraints, timeoutMs = 4000): Promise<MediaStream> => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Timeout: Mic request hanging")), timeoutMs);
          navigator.mediaDevices.getUserMedia(constraints)
            .then(stream => { clearTimeout(timer); resolve(stream); })
            .catch(err => { clearTimeout(timer); reject(err); });
        });
      };

      console.log("TRACE: startRecording -> requesting getUserMedia...");
      const stream = await getUserMediaWithTimeout({ audio: true });
      console.log("TRACE: startRecording -> getUserMedia OK (Stream Active)");
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
        ? 'audio/webm' 
        : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
      
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const actualMimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: actualMimeType });
        
        console.log("Recording stopped. Blob size:", audioBlob.size, "Type:", actualMimeType);

        if (mediaRecorderRef.current?.stream) {
          mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }

        if (!apiKey) {
          alert("שגיאה במפתח ה-API: המפתח חסר (אנא ודא שהגדרת מפתח Gemini).");
          return;
        }

        if (audioChunksRef.current.length === 0 || audioBlob.size < 100) {
          alert("שגיאה: כמות המידע שהוקלטה קטנה מדי. ייתכן והמיקרופון נחסם.");
          return;
        }

        setIsProcessingAudio(true);
        try {
          const currentOpenThreads = entries.flatMap((e: any) => (e.openThreads || []).map((t: any) => typeof t === 'string' ? t : t.text));
          const result = await processAudioSession(audioBlob, apiKey, currentOpenThreads);
          if (result.transcript === 'NO_SPEECH_DETECTED') {
            alert("לא זוהה דיבור ברור בהקלטה, הרשומה בוטלה ולא נשמרה ביומן.");
            setIsProcessingAudio(false);
            return;
          }
          
          // Append current user transcript
          const updatedTranscript = sessionTranscript ? `${sessionTranscript}\nמשתמש: ${result.transcript}` : `משתמש: ${result.transcript}`;
          
          // If we haven't reached the 2 question limit, ask AI for a question
          if (questionCount < 2) {
            const question = await generateClarifyingQuestion(updatedTranscript, apiKey);
            if (question && question !== "DONE") {
              setSessionTranscript(`${updatedTranscript}\nענן המחשבות: ${question}`);
              setPendingQuestion(question);
              setQuestionCount(prev => prev + 1);
              setIsProcessingAudio(false);
              return; // Wait for user's next recording
            }
          }
          
          // AI finished or we reached the limit - save the final conversation
          const finalResult = await processTextSession(updatedTranscript, apiKey, currentOpenThreads);
          addEntry(finalResult);
          
          // Reset states
          setSessionTranscript('');
          setPendingQuestion(null);
          setQuestionCount(0);
          
        } catch (e: any) {
          console.error("Recording process error:", e);
          alert("שגיאה בתמלול וניתוח ההקלטה (" + e.name + "): " + (e.message || JSON.stringify(e)));
        } finally {
          setIsProcessingAudio(false);
        }
      };

      recorder.onerror = (e) => {
        console.error("Recorder fired onerror:", e);
        setIsRecording(false);
        if (mediaRecorderRef.current?.stream) {
          mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }
      };

      setRecordingTime(0);
      setIsRecording(true);
      
      try {
        console.log("TRACE: startRecording (STAGE 4: Hardware Start Request)");
        recorder.start(1000);
        console.log("TRACE: startRecording (STAGE 5: Hardware OK - Timer Starting)");
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = window.setInterval(() => {
          setRecordingTime(prev => prev + 1);
        }, 1000);
      } catch (startErr: any) {
        setIsRecording(false);
        console.error("Hardware start failed:", startErr);
        throw startErr;
      }
    } catch (e: any) {
      console.error("Start recording error:", e);
      if (e.message?.includes("Timeout")) {
         alert("המיקרופון לא מגיב. תופעה זו מוכרת לאחר מעבר חלונות בטלפונים מסוימים. אנא סגור לחלוטין את האפליקציה (החלק אותה למעלה) ופתח מחדש.");
      } else {
         alert("שגיאה בגישה למיקרופון (" + e.name + "): " + (e.message || "יש לאפשר הרשאות מיקרופון בהגדרות המכשיר."));
      }
    }
  };

  const stopRecording = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const cancelRecording = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
    }
    if (mediaRecorderRef.current?.stream) {
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    setIsRecording(false);
    setRecordingTime(0);
  };

  const handleSendText = async () => {
    if (!textInput.trim() || !apiKey) return;
    setIsProcessingText(true);
    try {
      const currentOpenThreads = entries.flatMap((e: any) => (e.openThreads || []).map((t: any) => typeof t === 'string' ? t : t.text));
      const result = await processTextSession(textInput, apiKey, currentOpenThreads);
      addEntry(result);
      setTextInput('');
      setShowTextInput(false);
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessingText(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-start text-center w-full h-full pt-10 pb-[100px] space-y-12">
      <div className="relative w-64 h-64 flex items-center justify-center mt-10">
        {/* Main Aura Effect */}
        <div className={cn(
          "absolute inset-0 bg-[#FFD54F] opacity-20 blur-[80px] rounded-full transition-all duration-1000",
          (isRecording || isLiveActive) ? "scale-150 opacity-40 animate-pulse" : "scale-100"
        )} />

        {/* Pending Question UI */}
        {pendingQuestion && !isRecording && (
          <div className="absolute top-[-140px] w-full max-w-[320px] bg-white/10 backdrop-blur-xl rounded-2xl p-5 shadow-2xl border border-white/20 text-center animate-in fade-in slide-in-from-bottom-4 z-30">
            <div className="text-[#FFD54F] text-sm font-bold mb-2 flex items-center justify-center gap-2">
              <span>ענן המחשבות שואל:</span>
            </div>
            <p className="text-white text-lg font-medium mb-4 leading-snug drop-shadow-sm">{pendingQuestion}</p>
            <div className="flex gap-3 justify-center">
              <button 
                onClick={startRecording}
                disabled={isProcessingAudio}
                className="flex-1 bg-gradient-to-r from-[#FFA000] to-[#FFC107] text-[#0A3B66] py-2 rounded-full font-bold shadow-md hover:brightness-110 transition-all text-sm active:scale-95"
              >
                הקלט תשובה
              </button>
              <button 
                onClick={async () => {
                  setIsProcessingAudio(true);
                  setPendingQuestion(null);
                  try {
                    const currentOpenThreads = entries.flatMap((e: any) => (e.openThreads || []).map((t: any) => typeof t === 'string' ? t : t.text));
                    const finalResult = await processTextSession(sessionTranscript, apiKey, currentOpenThreads);
                    addEntry(finalResult);
                    setSessionTranscript('');
                    setQuestionCount(0);
                  } catch (e: any) {
                    alert("שגיאה בסיום: " + e.message);
                  } finally {
                    setIsProcessingAudio(false);
                  }
                }}
                disabled={isProcessingAudio}
                className="flex-1 bg-white/10 border border-white/20 text-white py-2 rounded-full font-bold hover:bg-white/20 transition-all text-sm active:scale-95"
              >
                דלג וסיים
              </button>
            </div>
          </div>
        )}
        
        {/* Right Button: Text Input (Notebook) */}
        {!isLiveActive && !isRecording && !pendingQuestion && (
          <button 
            onClick={() => setShowTextInput(!showTextInput)}
            className={cn(
              "absolute right-[-40px] w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all border border-white/20 active:scale-90 bg-gradient-to-tr from-[#FFA000] to-[#FFC107] text-[#0A3B66]",
              showTextInput && "ring-4 ring-white/30"
            )}
          >
            <Notebook size={28} strokeWidth={2} />
          </button>
        )}

        {/* Main Mic Button */}
        <div className="relative group">
          <button 
            onClick={() => isRecording ? stopRecording() : startRecording()}
            disabled={isLiveActive}
            className={cn(
              "relative z-10 w-[180px] h-[180px] bg-gradient-to-t from-[#FFA000] to-[#FFC107] rounded-full flex items-center justify-center text-white shadow-[0_15px_45px_rgba(255,160,0,0.5)] transition-all",
              isRecording ? "scale-95 brightness-110 shadow-inner ring-8 ring-white/20" : "hover:scale-105 shadow-[0_12px_40px_rgba(255,160,0,0.4)]",
              isLiveActive && "opacity-20 grayscale cursor-not-allowed"
            )}
          >
            {isRecording ? <Square size={70} fill="white" className="rounded-xl animate-pulse" /> : <Mic size={90} strokeWidth={2.5} />}
            {isRecording && (
              <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 bg-white text-[#0D3B66] px-4 py-1.5 rounded-full font-bold shadow-lg animate-bounce">
                סיים
              </div>
            )}
          </button>

          {/* Left Button: LIVE */}
          {!isRecording && (
            <button 
              onClick={() => handleToggleVoice()}
              className={cn(
                "absolute left-[-50px] top-1/2 -translate-y-1/2 w-16 h-16 rounded-full flex flex-col items-center justify-center shadow-lg transition-all border border-white/20 active:scale-90",
                isLiveActive 
                  ? "bg-red-500 text-white ring-4 ring-red-500/30 animate-pulse" 
                  : "bg-white/20 backdrop-blur-md text-white hover:bg-white/30"
              )}
            >
              <div className="w-6 h-6 rounded-full border-2 border-current animate-pulse flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-current" />
              </div>
              <span className="text-[10px] font-bold mt-1 uppercase">LIVE</span>
            </button>
          )}
        </div>
      </div>

      {/* Text Input Area */}
      {showTextInput && !isLiveActive && !isRecording && (
        <div className="w-full max-w-md bg-white/20 backdrop-blur-2xl rounded-2xl p-4 border border-white/40 shadow-2xl animate-in fade-in slide-in-from-bottom-4 transition-all" dir="rtl">
          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="מה עובר עליך? כתוב כאן..."
            className="w-full h-32 bg-transparent text-white placeholder-white/50 border-none outline-none resize-none text-lg leading-relaxed"
            autoFocus
          />
          <div className="flex justify-between items-center mt-2">
            <button 
              onClick={() => setShowTextInput(false)}
              className="text-white/60 hover:text-white text-sm"
            >
              ביטול
            </button>
            <button 
              onClick={handleSendText}
              disabled={isProcessingText || !textInput.trim()}
              className="bg-[#FFC107] text-[#0A3B66] px-6 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-[#FFE082] transition-all disabled:opacity-50"
            >
              {isProcessingText ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              שמור
            </button>
          </div>
        </div>
      )}

      {(isRecording || isLiveActive) && (
        <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 w-full scale-50">
          <VoicePulse status={isLiveActive ? (liveStatus === 'speaking' ? 'speaking' : 'listening') : 'listening'} />
        </div>
      )}

      <div className="space-y-4">
        {isLiveActive ? (
          <div className="bg-white/10 backdrop-blur-md rounded-[2.5rem] p-5 max-w-xs mx-auto border border-white/10 shadow-xl">
            <p className="text-sm italic text-white/90 leading-relaxed">{liveTranscript || "מקשיב לך..."}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <h2 className="text-3xl font-medium text-[#89CFF0] opacity-80 tracking-tight">
              {isProcessingAudio ? "מנתח הקלטה..." : (isRecording ? "מקשיב..." : "לחץ להקלטה")}
            </h2>
            {isProcessingAudio && (
               <div className="mt-4 flex flex-col items-center gap-2">
                 <Loader2 size={40} className="animate-spin text-[#FFD54F]" />
                 <p className="text-white/40 text-sm italic">זה עשוי לקחת כמה שניות בלבד...</p>
               </div>
            )}
            {isRecording && (
              <>
                <div className="text-2xl font-mono mt-3 text-[#FFD54F] drop-shadow-[0_0_8px_rgba(255,213,79,0.8)]">
                  {Math.floor(recordingTime / 60).toString().padStart(2, '0')}:
                  {(recordingTime % 60).toString().padStart(2, '0')}
                </div>
                <button 
                  onClick={cancelRecording}
                  className="mt-4 text-white/40 hover:text-white/60 text-sm flex items-center gap-2"
                >
                  <X size={14} /> ביטול הקלטה
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
