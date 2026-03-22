import React, { useState, useRef, useEffect } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useAppStore } from '../store';
import { synthesizeSpeech } from '../services/tts';

// Utility for tailwind classes (copied from App.tsx)
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SpeechButtonProps {
  text: string;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}

export default function SpeechButton({ text, className, onClick }: SpeechButtonProps) {
  const [isReading, setIsReading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { apiKey } = useAppStore();

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const toggleSpeech = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClick) onClick(e);

    if (isReading) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      window.speechSynthesis.cancel();
      setIsReading(false);
      return;
    }

    if (!apiKey) {
      alert("אנא הגדר מפתח API כדי להשתמש בהקראה.");
      return;
    }

    try {
      setIsReading(true);
      const audioUrl = await synthesizeSpeech(text, apiKey);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      
      audio.onended = () => {
        setIsReading(false);
        audioRef.current = null;
      };
      
      audio.onerror = () => {
        setIsReading(false);
        audioRef.current = null;
      };

      await audio.play();
    } catch (error: any) {
      console.error("Cloud TTS Error:", error);
      
      // Attempt browser fallback
      try {
        console.log("Attempting browser TTS fallback...");
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'he-IL';
        
        // Try to find a feminine or specific Hebrew voice
        const voices = window.speechSynthesis.getVoices();
        const hebrewVoice = voices.find(v => v.lang.startsWith('he')) || voices[0];
        if (hebrewVoice) utterance.voice = hebrewVoice;
        
        utterance.onend = () => setIsReading(false);
        utterance.onerror = () => setIsReading(false);
        
        window.speechSynthesis.speak(utterance);
      } catch (fallbackError) {
        console.error("Browser TTS Fallback Error:", fallbackError);
        alert(`שגיאת הקראה: ${error.message}\n\nנא לוודא ש-Cloud Text-to-Speech API מופעל בחשבון ה-Google Cloud שלך.`);
        setIsReading(false);
      }
    }
  };

  return (
    <button
      onClick={toggleSpeech}
      className={cn(
        "w-7 h-7 rounded-full flex items-center justify-center transition-all bg-white/5 hover:bg-white/10",
        isReading ? "text-[#FFD54F] animate-pulse" : "text-white/30 hover:text-white/60",
        className
      )}
      title="הקרא טקסט (Neural)"
    >
      {isReading ? <VolumeX size={14} /> : <Volume2 size={14} />}
    </button>
  );
}
