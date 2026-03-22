import { motion } from 'framer-motion';
import { Mic, Volume2 } from 'lucide-react';
import { cn } from '../App';

interface VoicePulseProps {
    status: 'disconnected' | 'connecting' | 'connected' | 'listening' | 'speaking' | 'error';
}

export default function VoicePulse({ status }: VoicePulseProps) {
    const isActive = status === 'listening' || status === 'speaking';
    const isSpeaking = status === 'speaking';

    return (
        <div className="flex flex-col items-center justify-center p-8 bg-white/10 backdrop-blur-2xl rounded-[3rem] border border-white/20 shadow-2xl">
            <div className="relative w-32 h-32 flex items-center justify-center">
                {/* Outer Pulses */}
                {isActive && (
                    <>
                        <motion.div
                            animate={{
                                scale: [1, 1.5, 2],
                                opacity: [0.5, 0.2, 0]
                            }}
                            transition={{
                                duration: 2,
                                repeat: Infinity,
                                ease: "easeOut"
                            }}
                            className={cn(
                                "absolute inset-0 rounded-full",
                                isSpeaking ? "bg-blue-400" : "bg-[#FFBC3B]"
                            )}
                        />
                        <motion.div
                            animate={{
                                scale: [1, 1.3, 1.7],
                                opacity: [0.3, 0.1, 0]
                            }}
                            transition={{
                                duration: 2,
                                repeat: Infinity,
                                ease: "easeOut",
                                delay: 0.5
                            }}
                            className={cn(
                                "absolute inset-0 rounded-full",
                                isSpeaking ? "bg-blue-300" : "bg-[#FFD54F]"
                            )}
                        />
                    </>
                )}

                {/* Central Core */}
                <motion.div
                    animate={isActive ? {
                        scale: isSpeaking ? [1, 1.1, 1] : [1, 1.05, 1],
                    } : {}}
                    transition={{
                        duration: 0.5,
                        repeat: Infinity,
                        ease: "easeInOut"
                    }}
                    className={cn(
                        "relative z-10 w-24 h-24 rounded-full flex items-center justify-center shadow-inner transition-colors duration-500",
                        status === 'connecting' && "bg-gray-400",
                        status === 'listening' && "bg-gradient-to-br from-[#FFD54F] to-[#FFA000]",
                        status === 'speaking' && "bg-gradient-to-br from-blue-400 to-blue-600",
                        status === 'error' && "bg-red-500"
                    )}
                >
                    {isSpeaking ? (
                        <Volume2 size={40} className="text-white animate-pulse" />
                    ) : (
                        <Mic size={40} className="text-white" />
                    )}
                </motion.div>
            </div>

            <div className="mt-6 text-center">
                <p className="text-lg font-bold text-white tracking-wide">
                    {status === 'connecting' && "מתחבר ל-Gemini..."}
                    {status === 'listening' && "אני מקשיב לך..."}
                    {status === 'speaking' && "Gemini חושב בקול..."}
                    {status === 'error' && "קרתה תקלה בחיבור"}
                </p>
                <p className="text-xs text-white/60 mt-1">
                    {status === 'listening' && "אפשר לדבר חופשי, אני אבין לבד מתי סיימת"}
                    {status === 'speaking' && "אפשר להפריע לי בכל שלב"}
                </p>
            </div>
        </div>
    );
}
