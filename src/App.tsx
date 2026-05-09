import { useState, useRef, useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence, type Variants } from 'motion/react';
import { 
  Bell, 
  Plus, 
  MessageSquare, 
  Settings, 
  Home, 
  Clock, 
  Volume2, 
  ChevronRight,
  Play,
  Pause,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Music,
  User as UserIcon,
  LogOut,
  ChevronDown,
  Trash2,
  Mail,
  ShieldCheck,
  Facebook,
  Mic,
  MicOff,
  Command,
  Zap,
  Tag,
  Camera,
  ChevronUp,
  ChevronLeft,
  ArrowRight,
  Pencil,
  Check,
  type LucideIcon
} from 'lucide-react';
import { auth, googleProvider, facebookProvider, db } from './lib/firebase';

// --- Utility for auditory confirmation ---
const playConfirmChime = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); 
    osc.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.1); 
    
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch (e) {
    console.warn("Audio Context failure:", e);
  }
};
import { 
  signInWithPopup, 
  onAuthStateChanged, 
  signOut, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  sendEmailVerification,
  type User 
} from 'firebase/auth';
import { collection, addDoc, getDocs, query, where, deleteDoc, doc, updateDoc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { CollapsibleSection } from './components/CollapsibleSection';
import { transcribeAudio, generateMotivation, parseCommandWithAI, generateSpeech } from './services/aiService';

// --- Types & Mock Data ---

type Tab = 'home' | 'alarms' | 'assistant' | 'settings' | 'profile' | 'themes' | 'auth' | 'voice-settings';

interface DailyContent {
  quote: string;
  imageUrl: string;
}

interface VoiceConfig {
  pitch: number;
  speed: number;
  tone: 'Calm' | 'Motivational' | 'Strict' | 'Friendly';
  gender: 'male' | 'female';
}

interface UserProfile {
  name: string;
  avatar: string;
  streak: number;
  totalAlarmsCompleted: number;
}

interface Alarm {
  id: string;
  hour: number;
  minute: number;
  period: 'AM' | 'PM';
  label: string;
  isEnabled: boolean;
  days: string[];
  noteType: 'text' | 'voice' | 'none';
  noteContent: string;
  audioUrl?: string;
  soundId: string;
  date?: string;
  userId?: string;
}

const SOUND_OPTIONS = [
  { id: 'chime', name: 'Gentle Chime', url: 'https://cdn.pixabay.com/audio/2022/03/24/audio_756289b433.mp3' },
  { id: 'nature', name: 'Nature Stream', url: 'https://cdn.pixabay.com/audio/2021/08/04/audio_0625624734.mp3' },
  { id: 'upbeat', name: 'Upbeat Melody', url: 'https://cdn.pixabay.com/audio/2021/11/25/audio_91b32e01df.mp3' },
  { id: 'radar', name: 'Signal Radar', url: 'https://cdn.pixabay.com/audio/2022/03/10/audio_5b30364956.mp3' },
];

const PRESETS = [
  { name: 'Morning', hour: 8, minute: 0, period: 'AM' as const },
  { name: 'Noon', hour: 1, minute: 0, period: 'PM' as const },
  { name: 'Evening', hour: 7, minute: 0, period: 'PM' as const },
  { name: 'Night', hour: 10, minute: 0, period: 'PM' as const },
  { name: 'Late Night', hour: 12, minute: 0, period: 'AM' as const },
];

// --- Components ---

const NavButton = ({ active, icon: Icon, label, onClick }: { active: boolean, icon: LucideIcon, label: string, onClick: () => void }) => (
  <button 
    onClick={onClick}
    className={`flex flex-col items-center gap-1 py-1 px-3 transition-all duration-300 relative ${active ? 'text-brand-violet' : 'text-white/40 hover:text-white/60'}`}
  >
    <Icon size={20} className={active ? 'scale-110' : 'scale-100'} />
    <span className="text-[9px] font-bold uppercase tracking-wider">{label}</span>
    {active && <motion.div layoutId="nav-indicator" className="absolute -bottom-1 w-1 h-1 rounded-full bg-brand-violet" />}
  </button>
);

const GlassCard = ({ children, className = "", onClick }: { children: ReactNode, className?: string, onClick?: () => void }) => (
  <div onClick={onClick} className={`glass-panel rounded-[28px] p-5 ${className}`}>
    {children}
  </div>
);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profileData, setProfileData] = useState<{name: string, gender?: string, photoURL?: string}>({name: ''});
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [showPermissions, setShowPermissions] = useState(false);
  const [permissionsState, setPermissionsState] = useState({ mic: false, camera: false });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [dailyContent, setDailyContent] = useState<DailyContent | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig>({
    pitch: 1.0,
    speed: 1.0,
    tone: 'Motivational',
    gender: 'male'
  });
  
  const [currentTheme, setCurrentTheme] = useState('Deep Space');
  const [previewStyle, setPreviewStyle] = useState<'Classic' | 'Neon' | 'Minimal' | 'Glass' | 'Retro'>('Classic');
  const [showDelayPicker, setShowDelayPicker] = useState(false);
  const [customSnoozeMins, setCustomSnoozeMins] = useState(10);
  const [isVoiceStopped, setIsVoiceStopped] = useState(false);
  
  // Auth State
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authError, setAuthError] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [emailForm, setEmailForm] = useState({ email: '', password: '', name: '' });
  const [verificationCode, setVerificationCode] = useState('');
  
  // Voice Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [isCommandRecording, setIsCommandRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [showSuccessFeedback, setShowSuccessFeedback] = useState(false);
  const [commandText, setCommandText] = useState("");

  const [recordedAudio, setRecordedAudio] = useState<string | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sound Selector State
  const [isSoundSelectorOpen, setIsSoundSelectorOpen] = useState(false);
  const [showNoteView, setShowNoteView] = useState(false);
  const [tempSoundId, setTempSoundId] = useState<string | null>(null);
  const [isSoundPlaying, setIsSoundPlaying] = useState(false);
  const soundPreviewAudioRef = useRef<HTMLAudioElement | null>(null);

  // New Alarm Modal State
  const [activeSubView, setActiveSubView] = useState<string | null>(null); // recurrence, sound, note

  const [permissionStatus, setPermissionStatus] = useState<'request' | 'not-found' | 'denied'>('request');

  useEffect(() => {
    const checkDevices = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setPermissionStatus('not-found');
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasMic = devices.some(d => d.kind === 'audioinput');
      if (!hasMic) setPermissionStatus('not-found');
    };
    checkDevices();
  }, []);

  const micPermissionFailedRef = useRef(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (activeTab !== 'home' && activeTab !== 'assistant') return;
    if (micPermissionFailedRef.current && !permissionsState.mic) return;
    
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition && (!recognitionRef.current || micPermissionFailedRef.current)) {
      // Clear old if exists
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch(e) {}
      }
      
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = async (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0])
          .map((result: any) => result.transcript)
          .join('')
          .toLowerCase();

        if (transcript.includes('hello gemini') || transcript.includes('hey gemini')) {
          console.log("Wake word detected!");
          playConfirmChime();
          setActiveTab('assistant');
          recognition.stop();
          
          // Voice Response for Wake Up
          const audioData = await generateSpeech("Hello! I'm listening. What can I do for you?", 'Kore');
          if (audioData) {
            const audio = new Audio(`data:audio/wav;base64,${audioData}`);
            audio.onended = () => {
              handleCommandRecording();
            };
            audio.play().catch(() => handleCommandRecording());
          } else {
            handleCommandRecording();
          }
        }
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        if (event.error === 'not-allowed') {
          micPermissionFailedRef.current = true;
          setRecordingError("Mic permission needed for wake word.");
          setShowPermissions(true);
          recognition.onend = null;
          recognition.stop();
        }
      };

      recognition.onend = () => {
        // Only restart if we're in the right tab AND permissions hasn't failed
        if ((activeTab === 'home' || activeTab === 'assistant') && !micPermissionFailedRef.current) {
          try { recognition.start(); } catch(e) {
            console.error("Failed to restart recognition", e);
          }
        }
      };

      recognitionRef.current = recognition;
      try { 
        recognition.start(); 
      } catch(e) { 
        console.warn("Recognition start failed", e);
        if ((e as Error).name === 'NotAllowedError') {
           micPermissionFailedRef.current = true;
        }
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, [activeTab, permissionsState.mic]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const userDoc = await getDoc(doc(db, 'users', u.uid));
        if (userDoc.exists()) {
          setProfileData(userDoc.data() as any);
        } else {
          // Initialize profile
          const initialData = { name: u.displayName || 'User', photoURL: u.photoURL || '' };
          setProfileData(initialData);
          await setDoc(doc(db, 'users', u.uid), initialData);
        }
      }
    });
    return unsubscribe;
  }, []);

  const handleAIGenerateNote = async () => {
    if (!draftAlarm.label && !draftAlarm.noteContent) return;
    const prompt = draftAlarm.noteContent || draftAlarm.label;
    const motivation = await generateMotivation(prompt, voiceConfig.tone);
    setDraftAlarm(p => ({ ...p, noteContent: motivation, noteType: 'text' }));
  };

  const handleEmailAuth = async () => {
    setAuthError(null);
    try {
      if (authMode === 'signup') {
        const userCred = await createUserWithEmailAndPassword(auth, emailForm.email, emailForm.password);
        await sendEmailVerification(userCred.user);
        await setDoc(doc(db, 'users', userCred.user.uid), { name: emailForm.name });
        setShowVerificationModal(true);
      } else {
        await signInWithEmailAndPassword(auth, emailForm.email, emailForm.password);
        setActiveTab('home');
      }
      setShowEmailModal(false);
    } catch (err: any) {
      console.error("Email auth failed", err);
      setAuthError(err.message || "Authentication failed. Please check your credentials.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setAlarms([]);
      setActiveTab('auth');
      setIsVoiceStopped(true);
      setProfileData({name: ''});
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  const handleLogin = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      setActiveTab('home');
    } catch (err: any) {
      console.error("Login failed", err);
      setAuthError(err.message || "Google Authentication failed.");
    }
  };

  const handleFacebookLogin = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, facebookProvider);
      setActiveTab('home');
    } catch (err: any) {
      console.error("Facebook Login failed", err);
      setAuthError(err.message || "Facebook Authentication failed.");
    }
  };

  const handleCommandRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setRecordingError("Voice interaction is not supported in this environment. Please type your command.");
      return;
    }
    if (isCommandRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        setIsCommandRecording(false);
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          setIsProcessing(true);
          const base64Audio = reader.result as string;
          const transcription = await transcribeAudio(base64Audio);
          setIsProcessing(false);
          
          if (transcription) {
            setShowSuccessFeedback(true);
            playConfirmChime();
            setTimeout(() => setShowSuccessFeedback(false), 2000);
            processTextCommand(transcription);
          }
        };
        
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsCommandRecording(true);
      setRecordingError(null);
    } catch (err: any) {
      console.error("Microphone access denied:", err);
      const errorMsg = (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError' || err.message.toLowerCase().includes('device not found'))
        ? "No microphone detected. Please type your command below."
        : (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
          ? "Microphone permission denied. Please allow access in browser."
          : "Microphone error. Please ensure hardware is available.";
      
      setRecordingError(errorMsg);
      if (err.name !== 'NotFoundError' && !err.message.toLowerCase().includes('device not found')) {
        setTimeout(() => setRecordingError(null), 5000);
      }
    }
  };

  const processTextCommand = async (text: string) => {
    setIsProcessing(true);
    try {
      const result = await parseCommandWithAI(text);
      console.log("AI Result:", result);
      
      let responseText = "Task completed.";

      if (result.action === 'CANCEL_ALL' || result.action === 'DELETE_ALL') {
        if (user) {
          const q = query(collection(db, `users/${user.uid}/alarms`));
          const snap = await getDocs(q);
          for (const alarmDoc of snap.docs) {
            await deleteDoc(doc(db, `users/${user.uid}/alarms/${alarmDoc.id}`));
          }
        } else {
          setAlarms([]);
          localStorage.setItem('wakenote_alarms', JSON.stringify([]));
        }
        responseText = "All alarms have been cancelled.";
        setShowSuccessFeedback(true);
        setTimeout(() => setShowSuccessFeedback(false), 2000);
      } else if (result.action === 'SET_ALARM' && result.params) {
        const { hour, minute = 0, period = 'AM', label, noteContent, noteType } = result.params;
        const newAlarm = {
          hour,
          minute,
          period,
          label: label || 'AI Scheduled',
          days: ['Daily'],
          noteType: noteType || 'none',
          noteContent: noteContent || `Scheduled via command: "${text}"`,
          soundId: 'chime',
          isEnabled: true,
          userId: user?.uid,
          date: new Date().toISOString().split('T')[0]
        };
        
        if (user) {
          await addDoc(collection(db, `users/${user.uid}/alarms`), newAlarm);
        } else {
          const alarmWithId = { ...newAlarm, id: Math.random().toString(36).substr(2, 9) } as Alarm;
          const updated = [...alarms, alarmWithId];
          setAlarms(updated);
          localStorage.setItem('wakenote_alarms', JSON.stringify(updated));
        }
        responseText = `Alarm set for ${hour}:${String(minute).padStart(2, '0')} ${period}.`;
        setShowSuccessFeedback(true);
        setTimeout(() => setShowSuccessFeedback(false), 2000);
      } else if (result.action === 'LIST_ALARMS') {
         setActiveTab('alarms');
         responseText = "Here are your alarms.";
      }

      // Voice Response
      const voiceName = voiceConfig.gender === 'female' ? 'Kore' : 'Charon';
      const audioData = await generateSpeech(responseText, voiceName);
      if (audioData) {
        const audio = new Audio(`data:audio/wav;base64,${audioData}`);
        audio.play().catch(console.error);
      }

    } catch (err) {
      console.error("Command processing failed", err);
    } finally {
      setIsProcessing(false);
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setRecordingError("Voice recording is not supported in this environment.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          setIsProcessing(true);
          const base64Audio = reader.result as string;
          setRecordedAudio(base64Audio);
          
          setIsRecording(false);
          // Real Transcription
          const transcription = await transcribeAudio(base64Audio);
          setIsProcessing(false);
          
          if (transcription) {
            setShowSuccessFeedback(true);
            playConfirmChime();
            setTimeout(() => setShowSuccessFeedback(false), 2000);
          }
          
          const autoLabel = transcription 
            ? transcription.split(' ').slice(0, 3).join(' ') + (transcription.split(' ').length > 3 ? '...' : '') 
            : 'Voice Note';
          
          setDraftAlarm(p => ({ 
            ...p, 
            noteContent: transcription || p.noteContent, 
            audioUrl: base64Audio,
            label: p.label || autoLabel
          }));
        };
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingError(null);
    } catch (err: any) {
      console.error("Microphone access denied:", err);
      const errorMsg = (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError' || err.message.toLowerCase().includes('device not found'))
        ? "No microphone detected. Please check your connection."
        : (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
          ? "Microphone permission denied. Please allow access in browser."
          : "Microphone error. Please ensure hardware is available.";
      
      setRecordingError(errorMsg);
      setTimeout(() => setRecordingError(null), 5000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  useEffect(() => {
    if (!user) {
      const saved = localStorage.getItem('wakenote_alarms');
      setAlarms(saved ? JSON.parse(saved) : []);
      return;
    }

    const q = query(collection(db, `users/${user.uid}/alarms`));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const alarmsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Alarm));
      setAlarms(alarmsData);
    });

    return unsubscribe;
  }, [user]);

  const [activeAlarmId, setActiveAlarmId] = useState<string | null>(null);
  const [editingAlarmId, setEditingAlarmId] = useState<string | null>(null);
  const activeAlarm = alarms.find(a => a.id === activeAlarmId);
  const [showCreateAlarm, setShowCreateAlarm] = useState(false);
  const [showNoteWarning, setShowNoteWarning] = useState(false);

  // New Alarm State
  const [draftAlarm, setDraftAlarm] = useState<Omit<Alarm, 'id' | 'isEnabled'>>({
    hour: 7,
    minute: 0,
    period: 'AM',
    label: '',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    noteType: 'none',
    noteContent: '',
    audioUrl: undefined,
    soundId: 'chime',
    date: new Date().toISOString().split('T')[0]
  });

  const toggleDay = (day: string) => {
    setDraftAlarm(prev => {
      const days = prev.days.includes(day)
        ? prev.days.filter(d => d !== day)
        : [...prev.days, day];
      return { ...prev, days: days.length === 0 ? ['Daily'] : days.filter(d => d !== 'Daily') };
    });
  };

  const saveAlarms = async (newAlarms: Alarm[]) => {
    if (!user) {
      setAlarms(newAlarms);
      localStorage.setItem('wakenote_alarms', JSON.stringify(newAlarms));
      return;
    }
    // With onSnapshot, we don't need to manually setAlarms for Firestore
  };

  const toggleAlarm = async (alarm: Alarm) => {
    if (!user) {
      const updated = alarms.map(a => a.id === alarm.id ? { ...a, isEnabled: !a.isEnabled } : a);
      saveAlarms(updated);
      return;
    }
    await updateDoc(doc(db, `users/${user.uid}/alarms/${alarm.id}`), { isEnabled: !alarm.isEnabled });
  };

  const deleteAlarm = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      const updated = alarms.filter(a => a.id !== id);
      saveAlarms(updated);
      return;
    }
    await deleteDoc(doc(db, `users/${user.uid}/alarms/${id}`));
  };

  const handleSaveAlarm = async (skipWarning = false) => {
    if (!skipWarning && draftAlarm.noteType === 'none' && !draftAlarm.label) {
      setShowNoteWarning(true);
      return;
    }

    const finalLabel = draftAlarm.label.trim() || (draftAlarm.noteContent ? draftAlarm.noteContent.slice(0, 20) + (draftAlarm.noteContent.length > 20 ? '...' : '') : 'Alarm');

    const alarmData = {
      ...draftAlarm,
      isEnabled: editingAlarmId ? (alarms.find(a => a.id === editingAlarmId)?.isEnabled ?? true) : true,
      label: finalLabel,
      audioUrl: recordedAudio || draftAlarm.audioUrl,
      userId: user?.uid
    };

    if (!user) {
      if (editingAlarmId) {
        const updated = alarms.map(a => a.id === editingAlarmId ? { ...a, ...alarmData } as Alarm : a);
        saveAlarms(updated);
      } else {
        const newAlarm: Alarm = { ...alarmData, id: Math.random().toString(36).substr(2, 9) } as Alarm;
        saveAlarms([...alarms, newAlarm]);
      }
    } else {
      // Stripping undefined values
      const sanitized = Object.fromEntries(
        Object.entries(alarmData).filter(([_, v]) => v !== undefined)
      );
      
      if (editingAlarmId) {
        await updateDoc(doc(db, `users/${user.uid}/alarms/${editingAlarmId}`), sanitized);
      } else {
        await addDoc(collection(db, `users/${user.uid}/alarms`), sanitized);
      }
    }
    
    setShowCreateAlarm(false);
    setEditingAlarmId(null);
    setShowNoteView(false);
    setShowNoteWarning(false);
    // Reset draft
    setDraftAlarm({ hour: 7, minute: 0, period: 'AM', label: '', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], noteType: 'none', noteContent: '', audioUrl: undefined, soundId: 'chime', date: new Date().toISOString().split('T')[0] });
    setRecordedAudio(null);
  };

  const handleSnooze = (mins: number) => {
    setActiveAlarmId(null);
    setShowDelayPicker(false);
    
    // In a real app, this would schedule a push notification
    // Here we'll simulate it with a timeout if the app is open
    setTimeout(() => {
      // Re-trigger the alarm if it was the one we snoozed
      if (activeAlarm) {
        setActiveAlarmId(activeAlarm.id);
      }
    }, mins * 60000);
  };

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setDraftAlarm(prev => ({ ...prev, hour: preset.hour, minute: preset.minute, period: preset.period }));
  };

  const pageVariants: Variants = {
    initial: { opacity: 0, scale: 0.96, y: 10, filter: 'blur(4px)' },
    animate: { 
      opacity: 1, 
      scale: 1, 
      y: 0, 
      filter: 'blur(0px)',
      transition: {
        duration: 0.5,
        ease: [0.16, 1, 0.3, 1], // Custom spring-like easing
        staggerChildren: 0.1
      }
    },
    exit: { 
      opacity: 0, 
      scale: 1.02, 
      y: -10, 
      filter: 'blur(4px)',
      transition: {
        duration: 0.3,
        ease: [0.16, 1, 0.3, 1]
      }
    }
  };

  const AuthView = () => (
    <motion.div 
      key="auth" 
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex flex-col items-center justify-center py-10 px-6 space-y-10 min-h-[70vh]"
    >
      <div className="text-center space-y-2">
        <h2 className="text-4xl font-black tracking-tighter italic">WakeNote<span className="text-brand-violet">AI</span></h2>
        <p className="text-white/20 text-[9px] font-black uppercase tracking-[0.3em]">Neural Awakening Protocol</p>
      </div>

      <div className="w-full space-y-6">
        <div className="flex p-1 bg-white/5 rounded-2xl border border-white/5">
          <button 
            onClick={() => setAuthMode('login')}
            className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${authMode === 'login' ? 'bg-brand-violet text-white' : 'text-white/20'}`}
          >
            Login
          </button>
          <button 
            onClick={() => setAuthMode('signup')}
            className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${authMode === 'signup' ? 'bg-brand-violet text-white' : 'text-white/20'}`}
          >
            Sign-up
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button 
            onClick={handleLogin}
            className="py-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center gap-2 font-black text-[9px] uppercase tracking-widest hover:bg-white/10 transition-all"
          >
            <img src="https://www.google.com/favicon.ico" className="w-3 h-3" alt="G" />
            Google
          </button>
          <button 
            onClick={handleFacebookLogin}
            className="py-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center gap-2 font-black text-[9px] uppercase tracking-widest hover:bg-white/10 transition-all"
          >
            <Facebook size={14} className="text-[#1877F2]" />
            Facebook
          </button>
        </div>

        <div className="relative py-2">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/5" /></div>
          <div className="relative flex justify-center text-[7px] uppercase font-black tracking-[0.4em] text-white/10"><span className="bg-brand-space px-4">Secure Link</span></div>
        </div>

        <button 
          onClick={() => setShowEmailModal(true)}
          className="w-full py-4 bg-white/5 rounded-2xl flex items-center justify-center gap-2 font-black text-[9px] uppercase tracking-widest hover:text-brand-violet transition-all border border-white/5"
        >
          <Mail size={14} />
          Email {authMode === 'login' ? 'Login' : 'Sign-up'}
        </button>

        {authError && (
          <p className="text-[8px] font-black uppercase text-red-500 text-center animate-pulse">{authError}</p>
        )}
      </div>
    </motion.div>
  );

  const ProfileView = () => {
    const defaultAvatars = [
      { url: "https://api.dicebear.com/7.x/avataaars/svg?seed=female", label: "Woman" },
      { url: "https://api.dicebear.com/7.x/avataaars/svg?seed=male", label: "Man" },
      { url: "https://api.dicebear.com/7.x/avataaars/svg?seed=neutral", label: "Other" }
    ];

    return (
      <motion.div 
        key="profile"
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="space-y-4 pb-20"
      >
        <div className="flex flex-col items-center py-4">
          <div className="w-24 h-24 rounded-[32px] bg-gradient-to-br from-brand-violet to-brand-green p-0.5 mb-3 relative group">
            <div className="w-full h-full rounded-[30px] bg-brand-surface overflow-hidden flex items-center justify-center">
              <img 
                src={profileData.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profileData.gender === 'female' ? 'female' : 'male'}`} 
                className="w-full h-full object-cover group-hover:scale-110 transition-transform" 
                alt="Avatar" 
              />
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onloadend = async () => {
                    const base64String = reader.result as string;
                    setProfileData(p => ({ ...p, photoURL: base64String }));
                    if (user) await updateDoc(doc(db, 'users', user.uid), { photoURL: base64String });
                  };
                  reader.readAsDataURL(file);
                }
              }}
            />
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="absolute bottom-1 right-1 w-7 h-7 bg-brand-violet text-white rounded-xl flex items-center justify-center shadow-lg border border-white/20"
            >
              <Camera size={14} />
            </button>
          </div>
          <h2 className="text-2xl font-black italic tracking-tighter">{profileData.name || 'Set Name'}</h2>
          <div className="flex items-center gap-1.5 mt-1 opacity-40">
            <ShieldCheck size={10} className="text-brand-green" />
            <span className="text-[8px] font-black uppercase tracking-[0.2em]">{user ? 'Neural Cloud Active' : 'Offline Mode'}</span>
          </div>
        </div>

        <GlassCard className="space-y-5 border-white/5 py-4">
          <div className="space-y-3">
             <div className="flex justify-between items-center px-1">
                <h3 className="text-[9px] font-black uppercase tracking-[0.3em] text-white/20">Identities</h3>
                <span className="text-[8px] font-bold text-brand-violet underline">Neuro-Sync</span>
             </div>
             <div className="flex gap-3 px-1 overflow-x-auto hide-scrollbar pb-1">
               {defaultAvatars.map((avatar, i) => (
                 <button 
                   key={i}
                   onClick={async () => {
                     const photoURL = avatar.url;
                     setProfileData(p => ({ ...p, photoURL }));
                     if (user) await updateDoc(doc(db, 'users', user.uid), { photoURL });
                   }}
                   className={`w-14 h-14 rounded-2xl overflow-hidden border transition-all p-0.5 flex-shrink-0 ${profileData.photoURL === avatar.url ? 'border-brand-violet bg-brand-violet/5' : 'border-white/5 bg-white/5 opacity-40'}`}
                 >
                   <img src={avatar.url} alt={avatar.label} className="w-full h-full object-cover rounded-xl" />
                 </button>
               ))}
               <button className="w-14 h-14 rounded-2xl border border-dashed border-white/10 flex items-center justify-center text-white/10 hover:text-white/20 transition-all flex-shrink-0">
                  <Plus size={20} />
               </button>
             </div>
          </div>

          <div className="space-y-4 px-1">
            <div className="space-y-1.5">
              <label className="text-[9px] font-black uppercase tracking-[0.4em] text-white/10 ml-1">Username</label>
              <input 
                type="text" 
                value={profileData.name} 
                onChange={async (e) => {
                  const newName = e.target.value;
                  setProfileData(p => ({ ...p, name: newName }));
                }}
                onBlur={async () => {
                  if (user) await updateDoc(doc(db, 'users', user.uid), { name: profileData.name });
                }}
                className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-brand-violet/40 placeholder:text-white/10"
                placeholder="Type Your Name"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[9px] font-black uppercase tracking-[0.4em] text-white/10 ml-1">Gender</label>
              <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5">
                {['male', 'female', 'other'].map(g => (
                  <button 
                    key={g}
                    onClick={async () => {
                      setProfileData(p => ({ ...p, gender: g }));
                      if (user) await updateDoc(doc(db, 'users', user.uid), { gender: g });
                    }}
                    className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${profileData.gender === g ? 'bg-brand-violet text-white shadow-lg' : 'text-white/20'}`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>

        <button 
           onClick={() => setActiveTab('home')}
           className="w-full py-5 bg-white text-brand-space rounded-[32px] font-black text-xs uppercase tracking-[0.4em] shadow-xl active:scale-[0.98] transition-all"
        >
          Save
        </button>

        <button 
           onClick={handleLogout}
           className="w-full mt-8 py-5 bg-white/5 border border-red-500/20 text-red-500 rounded-[28px] font-black text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] hover:bg-red-500/10 transition-all flex items-center justify-center gap-3 group"
        >
          <LogOut size={14} className="group-hover:translate-x-1 transition-transform" />
          Terminate Session
        </button>
      </motion.div>
    );
  };

  const ThemesView = () => (
    <motion.div 
      key="themes"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="space-y-6 pb-24"
    >
      <div className="flex items-center gap-4 mb-4">
        <button onClick={() => setActiveTab('settings')} className="p-2 glass-panel rounded-full text-white/40"><ChevronRight size={20} className="rotate-180" /></button>
        <h2 className="text-2xl font-black tracking-tighter">Theme Library</h2>
      </div>

      <section>
        <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40 mb-4 ml-4">App Appearance</h3>
        <div className="grid grid-cols-1 gap-4">
          {[
            { id: 'default', name: 'Deep Space', color: 'bg-[#0B0F1A]', desc: 'Original dark mode with Inter font.', class: '' },
            { id: 'cyber', name: 'Cyber Neon', color: 'bg-[#050505]', desc: 'High energy Cyan/Pink with Space Grotesk.', class: 'theme-cyber' },
            { id: 'editorial', name: 'Royal Editorial', color: 'bg-[#FDFCF8]', desc: 'Elegant Beige/Gold with Playfair Display.', class: 'theme-editorial' },
          ].map(theme => (
            <GlassCard 
              key={theme.name} 
              onClick={() => setCurrentTheme(theme.name)}
              className={`relative flex items-center gap-4 border-2 transition-all ${currentTheme === theme.name ? 'border-brand-violet' : 'border-transparent'}`}
            >
              <div className={`w-14 h-14 rounded-2xl ${theme.color} border border-white/10 flex items-center justify-center font-black text-xs ${theme.class === 'theme-editorial' ? 'text-brand-space' : 'text-white'}`}>
                Aa
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-sm">{theme.name}</h4>
                <p className="text-[10px] text-white/40 font-medium">{theme.desc}</p>
              </div>
              {currentTheme === theme.name && <CheckCircle2 size={16} className="text-brand-violet" />}
            </GlassCard>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between mb-4 px-4">
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">Alarm Preview Style</h3>
          <span className="text-[9px] bg-brand-violet/20 text-brand-violet px-2 py-0.5 rounded-full font-black uppercase">5 Styles</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(['Classic', 'Neon', 'Minimal', 'Glass', 'Retro'] as const).map(style => (
            <button 
              key={style}
              onClick={() => setPreviewStyle(style)}
              className={`py-4 rounded-[24px] border-2 transition-all font-black text-[10px] uppercase tracking-widest ${previewStyle === style ? 'bg-brand-violet border-brand-violet text-white shadow-lg' : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10'}`}
            >
              {style}
            </button>
          ))}
        </div>
      </section>

      <button className="w-full mt-6 py-10 rounded-[32px] border-2 border-dashed border-white/5 flex flex-col items-center justify-center gap-3 text-white/20 hover:text-white/40 hover:bg-white/5 transition-all">
        <Plus size={24} />
        <span className="font-black text-[10px] uppercase tracking-widest">Create Custom Theme</span>
      </button>
    </motion.div>
  );

  const SettingsView = () => (
    <motion.div 
      key="settings" 
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="space-y-5 pb-20"
    >
      <div className="flex items-center gap-4 mb-4 p-4 bg-white/5 rounded-[40px] border border-white/5">
        <div className="w-12 h-12 rounded-2xl bg-brand-violet overflow-hidden flex items-center justify-center p-0.5">
           <img 
             src={profileData.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profileData.gender === 'female' ? 'female' : 'male'}`} 
             alt="Avatar" className="w-full h-full object-cover rounded-xl" 
           />
        </div>
        <div className="flex-1">
          <div className="font-black text-lg tracking-tight italic uppercase">{profileData.name || 'WAKENOTE AI'}</div>
          <button onClick={() => setActiveTab('profile')} className="text-brand-violet text-[9px] font-black uppercase tracking-widest">Update Profile</button>
        </div>
        <ChevronRight size={16} className="text-white/10" />
      </div>

      <section className="space-y-3">
        <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/20 ml-2">Neural Interface</h3>
        <div className="space-y-3">
          <GlassCard onClick={() => setActiveTab('themes')} className="flex items-center justify-between group py-5">
            <div className="flex items-center gap-4 text-white/60">
              <div className="w-8 h-8 rounded-xl bg-brand-violet/10 flex items-center justify-center text-brand-violet"><Home size={16} /></div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest mb-0.5">App Theme</div>
                <div className="text-[9px] font-bold text-white/20">{currentTheme}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
               <span className="text-[9px] font-black text-brand-violet uppercase">Store</span>
               <ChevronRight size={14} className="text-white/10 group-hover:text-white/40 transition-colors" />
            </div>
          </GlassCard>
          
          <GlassCard onClick={() => setActiveTab('voice-settings')} className="flex items-center justify-between group py-5">
            <div className="flex items-center gap-4 text-white/60">
              <div className="w-8 h-8 rounded-xl bg-brand-green/10 flex items-center justify-center text-brand-green"><Volume2 size={16} /></div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest mb-0.5">AI Voice Synthesis</div>
                <div className="text-[9px] font-bold text-white/20">{voiceConfig.tone} · {voiceConfig.speed}x</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
               <span className="text-[9px] font-black text-brand-green uppercase">Config</span>
               <ChevronRight size={14} className="text-white/10 group-hover:text-white/40 transition-colors" />
            </div>
          </GlassCard>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/20 ml-2">App Protocol</h3>
        <GlassCard className="p-4 flex items-center justify-between text-white/10 italic text-[10px] font-bold border-white/5">
          <span className="flex items-center gap-2 italic tracking-tighter uppercase"><Bell size={10} className="text-brand-violet" /> WakeNoteAI v2.0.1</span>
          <span className="font-mono text-[8px] uppercase tracking-widest">Build 9924-X</span>
        </GlassCard>
      </section>
    </motion.div>
  );

  const AlarmTriggerView = () => {
    const timeStr = activeAlarm ? `${String(activeAlarm.hour).padStart(2, '0')}:${String(activeAlarm.minute).padStart(2, '0')}` : '00:00';
    const period = activeAlarm?.period;

    const renderContent = () => {
      switch (previewStyle) {
        case 'Neon':
          return (
            <div className="flex flex-col items-center justify-center h-full space-y-12 relative overflow-hidden">
              {/* Animated Scanline */}
              <motion.div 
                animate={{ translateY: ['-100%', '200%'] }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 z-0 bg-gradient-to-b from-transparent via-brand-violet/20 to-transparent pointer-events-none"
              />
              
              <div className="relative z-10">
                <motion.div 
                  animate={{ 
                    scale: [1, 1.15, 1], 
                    opacity: [0.4, 1, 0.4],
                    filter: ['blur(40px)', 'blur(80px)', 'blur(40px)']
                  }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-0 bg-brand-violet rounded-full"
                />
                <motion.div 
                  animate={{ 
                    scale: [1, 1.05, 1],
                    textShadow: [
                      "0 0 20px rgba(124, 92, 255, 0.8)",
                      "0 0 40px rgba(124, 92, 255, 1)",
                      "0 0 20px rgba(124, 92, 255, 0.8)"
                    ]
                  }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="relative text-[120px] font-black tracking-tighter leading-none italic text-white"
                >
                  {timeStr}
                </motion.div>
                <div className="text-center font-tech text-brand-green tracking-[1em] text-sm mt-4 animate-pulse uppercase">Neural Burst Detected</div>
              </div>

              <div className="flex flex-col w-full gap-4 px-4 z-10">
                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setActiveAlarmId(null)} 
                  className="w-full py-6 bg-brand-violet text-white font-black uppercase tracking-[0.5em] shadow-[0_0_40px_rgba(124,92,255,0.6)] rounded-2xl"
                >
                  DISMISS
                </motion.button>
                <button 
                  onClick={() => setShowDelayPicker(true)} 
                  className="w-full py-6 border border-brand-green/30 text-brand-green font-black uppercase tracking-[0.5em] active:scale-95 transition-all rounded-2xl bg-brand-green/5"
                >
                  SNOOZE
                </button>
              </div>
            </div>
          );
        case 'Minimal':
          return (
            <div className="flex flex-col h-full justify-between py-20 px-10">
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-4"
              >
                <motion.div 
                  animate={{ width: ['0px', '48px', '24px'] }}
                  className="h-1 bg-brand-violet" 
                />
                <motion.h1 
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 3, repeat: Infinity }}
                  className="text-8xl font-light tracking-tighter"
                >
                  {timeStr}
                </motion.h1>
                <p className="text-sm font-medium text-white/40 uppercase tracking-[0.3em] italic">{activeAlarm?.label || 'The day awaits'}</p>
              </motion.div>
              
              <div className="space-y-10">
                <motion.button 
                  whileHover={{ x: 10 }}
                  onClick={() => setActiveAlarmId(null)} 
                  className="text-5xl font-black italic hover:text-brand-violet transition-colors flex items-center gap-4"
                >
                  Dismiss <ArrowRight size={40} className="text-brand-violet" />
                </motion.button>
                <button 
                  onClick={() => setShowDelayPicker(true)} 
                  className="block text-2xl font-bold text-white/10 hover:text-brand-violet/40 transition-colors uppercase tracking-widest"
                >
                  Snooze +
                </button>
              </div>
            </div>
          );
        case 'Glass':
          return (
            <div className="flex flex-col items-center justify-center h-full p-8 relative overflow-hidden">
              {/* Shifting Ambient Blurs */}
              <motion.div 
                animate={{ 
                  scale: [1, 1.2, 1],
                  rotate: [0, 90, 0],
                  translateX: [-50, 50, -50]
                }}
                transition={{ duration: 10, repeat: Infinity }}
                className="absolute top-1/4 -right-1/4 w-96 h-96 bg-brand-violet/20 blur-[100px] rounded-full"
              />
              <motion.div 
                animate={{ 
                  scale: [1.2, 1, 1.2],
                  rotate: [0, -90, 0],
                  translateX: [50, -50, 50]
                }}
                transition={{ duration: 12, repeat: Infinity }}
                className="absolute bottom-1/4 -left-1/4 w-96 h-96 bg-brand-green/10 blur-[100px] rounded-full"
              />

              <div className="w-full aspect-square glass-panel rounded-[60px] flex flex-col items-center justify-center relative overflow-hidden z-10 border-white/20 backdrop-blur-3xl shadow-2xl">
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent pointer-events-none" />
                <motion.div 
                  animate={{ scale: [0.95, 1, 0.95] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="text-9xl font-black tracking-tighter text-white drop-shadow-2xl"
                >
                  {timeStr}
                </motion.div>
                <div className="mt-2 px-6 py-2 bg-white/10 rounded-full text-[12px] font-black uppercase tracking-[0.5em] text-white/60 border border-white/10">{period}</div>
                
                <div className="absolute bottom-12 flex gap-4">
                   {[0, 1, 2].map(i => (
                     <motion.div 
                       key={i}
                       animate={{ 
                         scale: [1, 1.5, 1],
                         backgroundColor: ['#7C5CFF', '#00FFAB', '#7C5CFF']
                       }}
                       transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}
                       className="w-3 h-3 rounded-full shadow-lg" 
                     />
                   ))}
                </div>
              </div>

              <div className="mt-12 w-full grid grid-cols-2 gap-6 z-10">
                <motion.button 
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setActiveAlarmId(null)} 
                  className="py-6 glass-panel rounded-[32px] font-black text-xs uppercase tracking-[0.3em] hover:bg-white/10 border-white/10"
                >
                  Stop Cycle
                </motion.button>
                <motion.button 
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowDelayPicker(true)} 
                  className="py-6 glass-panel rounded-[32px] font-black text-xs uppercase tracking-[0.3em] hover:bg-white/10 border-white/10"
                >
                  Neural delay
                </motion.button>
              </div>
            </div>
          );
        case 'Retro':
          return (
            <div className="flex flex-col items-center justify-center h-full space-y-12 font-mono relative overflow-hidden bg-brand-space">
              {/* CRT Static Effect Overlay */}
              <div className="absolute inset-0 pointer-events-none opacity-[0.03] z-50 bg-[url('https://media.giphy.com/media/oEI9uWU0WMrQmURwEc/giphy.gif')] mix-blend-overlay" />
              
              <motion.div 
                animate={{ 
                  boxShadow: [
                    '12px 12px 0 #7C5CFF',
                    '20px 20px 0 #00FFAB',
                    '12px 12px 0 #7C5CFF'
                  ]
                }}
                transition={{ duration: 0.5, repeat: Infinity }}
                className="border-8 border-white p-12 bg-white text-brand-space relative z-10"
              >
                <motion.div 
                  animate={{ opacity: [1, 0.95, 1] }}
                  transition={{ duration: 0.1, repeat: Infinity }}
                  className="text-[120px] leading-none font-black tracking-tighter"
                >
                  {timeStr}
                </motion.div>
              </motion.div>

              <div className="grid grid-cols-1 w-full gap-6 px-10 z-10">
                <motion.button 
                  whileTap={{ scale: 0.98, x: 2, y: 2 }}
                  onClick={() => setActiveAlarmId(null)} 
                  className="w-full py-6 bg-brand-green border-4 border-brand-space text-brand-space font-black uppercase tracking-tighter text-3xl shadow-[8px_8px_0] shadow-brand-space transition-all"
                >
                  AWAKE.EXE
                </motion.button>
                <button 
                  onClick={() => setShowDelayPicker(true)} 
                  className="w-full py-4 bg-brand-violet border-4 border-brand-space text-brand-space font-black uppercase tracking-tighter text-xl shadow-[8px_8px_0] shadow-brand-space active:translate-x-1 active:translate-y-1 active:shadow-none transition-all"
                >
                  DELAY SESSION
                </button>
              </div>
            </div>
          );
        default: // Classic
          return (
            <div className="relative z-10 flex flex-col h-full pt-12">
              <div className="text-center mb-10">
                <motion.div 
                  animate={{ 
                    scale: [1, 1.05, 1],
                    textShadow: [
                      "0 0 10px rgba(124, 92, 255, 0)",
                      "0 0 30px rgba(124, 92, 255, 0.5)",
                      "0 0 10px rgba(124, 92, 255, 0)"
                    ],
                    color: ['#FFFFFF', '#7C5CFF', '#FFFFFF']
                  }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="text-[110px] font-black font-mono tracking-tighter leading-none"
                >
                  {timeStr}
                  <span className="text-3xl ml-2 font-sans opacity-40">{period}</span>
                </motion.div>
                <div className="flex items-center justify-center gap-3 mt-4">
                  <motion.div 
                    animate={{ width: [40, 60, 40], backgroundColor: ['#7C5CFF', '#00FFAB', '#7C5CFF'] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="h-1 rounded-full"
                  />
                  <span className="text-brand-violet font-black uppercase tracking-[0.5em] text-[10px]">Neural Pulse Active</span>
                  <motion.div 
                    animate={{ width: [40, 60, 40], backgroundColor: ['#7C5CFF', '#00FFAB', '#7C5CFF'] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="h-1 rounded-full"
                  />
                </div>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center text-center px-4 relative">
                 {/* Enhanced Orbital Clock Animation */}
                 <div className="absolute w-[400px] h-[400px] flex items-center justify-center pointer-events-none">
                   {/* Core Neural Pulse Layers */}
                   <motion.div 
                     animate={{ scale: [1, 1.3, 1], opacity: [0.05, 0.2, 0.05] }}
                     transition={{ duration: 6, repeat: Infinity }}
                     className="absolute w-80 h-80 rounded-full bg-brand-violet/20 blur-[100px]"
                   />
                   <motion.div 
                     animate={{ scale: [1.2, 1, 1.2], opacity: [0.02, 0.1, 0.02] }}
                     transition={{ duration: 8, repeat: Infinity }}
                     className="absolute w-64 h-64 rounded-full bg-brand-green/20 blur-[80px]"
                   />
                   
                   {/* Triple Ring System */}
                   <motion.div 
                     animate={{ rotate: 360 }}
                     transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
                     className="absolute inset-0 rounded-full border border-white/5 p-4"
                   >
                      {[...Array(12)].map((_, i) => (
                        <motion.div 
                          key={i} 
                          animate={{ opacity: [0.1, 0.4, 0.1] }}
                          transition={{ duration: 2, repeat: Infinity, delay: i * 0.1 }}
                          className="absolute top-0 left-1/2 -ml-[1px] w-[2px] h-8 bg-white/30 origin-bottom"
                          style={{ transform: `rotate(${i * 30}deg) translateY(10px)` }}
                        />
                      ))}
                   </motion.div>

                   <motion.div 
                     animate={{ rotate: -360 }}
                     transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                     className="absolute inset-10 rounded-full border border-brand-violet/20 border-dotted"
                   />

                   <motion.div 
                     animate={{ rotate: 360 }}
                     transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                     className="absolute inset-20 rounded-full border-t-2 border-brand-green/40 shadow-[0_0_50px_rgba(0,255,171,0.1)]"
                   />
                 </div>

                 <motion.div 
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="z-10 relative"
                 >
                   <h1 className="text-6xl font-black mb-8 leading-tight tracking-tighter drop-shadow-2xl italic">
                    {activeAlarm?.label || 'Neural Rising'}
                   </h1>
                   
                   {!isVoiceStopped && (
                     <div className="flex items-center justify-center gap-2 h-16 mb-12">
                        {[1,4,8,12,16,12,8,4,1].map((h, i) => (
                          <motion.div 
                            key={i}
                            animate={{ 
                              height: [`${h * 2}px`, `${h * 5}px`, `${h * 2}px`],
                              backgroundColor: ['#7C5CFF', '#00FFAB', '#7C5CFF'],
                              boxShadow: [
                                '0 0 10px rgba(124, 92, 255, 0.2)',
                                '0 0 30px rgba(0, 255, 171, 0.5)',
                                '0 0 10px rgba(124, 92, 255, 0.2)'
                              ]
                            }}
                            transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.05 }}
                            className="w-2.5 rounded-full"
                          />
                        ))}
                     </div>
                   )}

                   {activeAlarm?.noteContent && (
                      <GlassCard className="bg-white/10 p-8 border-white/10 max-w-[300px] relative rounded-[48px] backdrop-blur-3xl shadow-2xl">
                        <motion.div 
                          animate={{ opacity: [0.8, 1, 0.8] }}
                          transition={{ duration: 2, repeat: Infinity }}
                        >
                          <p className="text-white text-xl font-bold leading-relaxed tracking-tight italic">
                            "{activeAlarm.noteContent}"
                          </p>
                        </motion.div>
                        
                        {activeAlarm?.audioUrl && !isVoiceStopped && (
                          <audio 
                            key={`voice-${activeAlarm.id}`}
                            autoPlay={!isVoiceStopped} 
                            src={activeAlarm.audioUrl} 
                            onEnded={() => setIsVoiceStopped(true)}
                            ref={(el) => { if (el) el.volume = 1; }}
                          />
                        )}
                        {activeAlarm?.soundId && !isVoiceStopped && (
                          <audio 
                            key={`sound-${activeAlarm.id}`}
                            autoPlay 
                            loop 
                            src={SOUND_OPTIONS.find(s => s.id === activeAlarm.soundId)?.url} 
                            ref={(el) => { if (el) el.volume = activeAlarm.audioUrl ? 0.3 : 0.8; }}
                          />
                        )}

                        <motion.button 
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => setIsVoiceStopped(!isVoiceStopped)}
                          className="mt-8 flex items-center gap-3 mx-auto px-6 py-3 bg-white text-brand-space rounded-full font-black text-[10px] uppercase tracking-[0.2em] shadow-xl"
                        >
                          {isVoiceStopped ? <Play size={16} fill="currentColor" /> : <Volume2 size={16} className="animate-pulse" />}
                          {isVoiceStopped ? 'Replay Feed' : 'Silence Feed'}
                        </motion.button>
                      </GlassCard>
                   )}
                 </motion.div>
              </div>

              <div className="mt-auto space-y-6 pb-8 px-6">
                <div className="space-y-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.5em] text-white/20 text-center">Neural Snooze Duration</p>
                  <div className="flex gap-3">
                    {[5, 10, 15].map(m => (
                      <motion.button 
                        key={m}
                        whileHover={{ y: -5 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => handleSnooze(m)}
                        className="flex-1 py-5 glass-panel rounded-[32px] text-base font-black text-white hover:bg-brand-violet hover:border-brand-violet transition-all shadow-lg active:bg-brand-violet/80"
                      >
                        {m}m
                      </motion.button>
                    ))}
                    <motion.button 
                      whileHover={{ scale: 1.1, rotate: 90 }}
                      onClick={() => setShowDelayPicker(true)}
                      className="w-16 h-16 glass-panel rounded-[32px] flex items-center justify-center text-white/40 hover:text-brand-violet"
                    >
                      <Plus size={24} />
                    </motion.button>
                  </div>
                </div>

                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setActiveAlarmId(null)}
                  className="w-full h-24 bg-white text-brand-space rounded-[40px] font-black text-2xl uppercase tracking-[0.3em] shadow-[0_0_50px_rgba(255,255,255,0.2)]"
                >
                  I'm Awake
                </motion.button>
              </div>
            </div>
          );
      }
    };

    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-brand-space flex flex-col overflow-hidden"
      >
        {renderContent()}
      </motion.div>
    );
  };

  const VoiceSettingsView = () => (
    <motion.div 
      key="voice-settings" 
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="space-y-6 pb-20"
    >
      <div className="flex items-center gap-4 mb-4">
        <button onClick={() => setActiveTab('settings')} className="w-10 h-10 glass-panel rounded-2xl flex items-center justify-center text-white/40"><ChevronLeft size={18} /></button>
        <div>
           <h2 className="text-2xl font-black italic tracking-tighter uppercase leading-none">Voice Synthesis</h2>
           <p className="text-[10px] font-black uppercase text-white/20 tracking-widest mt-1">Neural Audio Config</p>
        </div>
      </div>

      <GlassCard className="space-y-8 p-6 py-8 border-white/5">
        <div className="flex flex-col items-center gap-4 py-4">
           <div className="w-16 h-16 rounded-3xl bg-brand-violet/10 border border-brand-violet/20 flex items-center justify-center text-brand-violet">
              <Volume2 size={32} />
           </div>
           <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20">Current Voice Profile: <span className="text-brand-violet">{voiceConfig.tone}</span></p>
        </div>

        <section className="space-y-4">
          <div className="flex justify-between items-center px-1">
             <h3 className="text-[9px] font-black uppercase tracking-[0.4em] text-white/20">Voice Gender</h3>
             <span className="text-[8px] font-bold text-brand-violet uppercase">Gemini Neural Voice</span>
          </div>
          <div className="flex bg-white/5 p-1 rounded-2xl border border-white/10">
            {['male', 'female'].map(g => (
              <button 
                key={g}
                onClick={() => setVoiceConfig(v => ({...v, gender: g as any}))}
                className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${voiceConfig.gender === g ? 'bg-brand-violet text-white shadow-lg' : 'text-white/20'}`}
              >
                {g}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex justify-between items-center px-1">
             <h3 className="text-[9px] font-black uppercase tracking-[0.4em] text-white/20">Emotional Tone</h3>
             <span className="text-[8px] font-bold text-brand-violet uppercase">Dynamic Pitch</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {['Calm', 'Motivational', 'Strict', 'Friendly'].map(t => (
              <button 
                key={t}
                onClick={() => setVoiceConfig(v => ({...v, tone: t as any}))}
                className={`py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border ${voiceConfig.tone === t ? 'bg-brand-violet border-brand-violet text-white shadow-lg shadow-brand-violet/20' : 'bg-white/5 border-white/10 text-white/20 hover:bg-white/10'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex justify-between items-center px-1">
             <h3 className="text-[9px] font-black uppercase tracking-[0.4em] text-white/20">Neural Velocity</h3>
             <span className="text-[10px] font-black text-brand-violet font-mono">{voiceConfig.speed}x</span>
          </div>
          <div className="px-1 pt-2">
            <input 
              type="range" min="0.5" max="2" step="0.1" 
              value={voiceConfig.speed}
              onChange={(e) => setVoiceConfig(v => ({...v, speed: parseFloat(e.target.value)}))}
              className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-brand-violet" 
            />
          </div>
        </section>

        <button className="w-full py-5 bg-white/5 border border-white/10 text-white/40 flex items-center justify-center gap-3 rounded-[32px] font-black text-[10px] uppercase tracking-widest hover:bg-white/10 transition-all">
           <Play size={14} fill="currentColor" /> Preview Configuration
        </button>
      </GlassCard>
    </motion.div>
  );
  const PermissionsView = () => {
    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-brand-space/95 backdrop-blur-xl flex items-center justify-center p-6"
      >
        <div className="w-full max-w-[300px] space-y-8 text-center">
          <div className={`w-20 h-20 rounded-[32px] flex items-center justify-center mx-auto transition-colors ${permissionStatus === 'not-found' ? 'bg-red-500/10 text-red-500' : 'bg-brand-violet/10 text-brand-violet'}`}>
            {permissionStatus === 'not-found' ? <MicOff size={40} /> : <ShieldCheck size={40} />}
          </div>
          
          <div className="space-y-2">
            <h2 className="text-2xl font-black uppercase tracking-tight">
              {permissionStatus === 'not-found' ? 'Mic Not Found' : 'Neural Link'}
            </h2>
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] leading-relaxed">
              {permissionStatus === 'not-found' 
                ? 'No microphone detected on this device. You can still use typing commands.'
                : 'Mic access is required for "Hello Gemini" wake word and voice commands.'}
            </p>
          </div>

          <div className="space-y-4">
            {permissionStatus === 'request' && (
              <button 
                onClick={async () => {
                  try {
                    await navigator.mediaDevices.getUserMedia({ audio: true });
                    setPermissionsState(p => ({ ...p, mic: true }));
                    micPermissionFailedRef.current = false;
                    setRecordingError(null);
                    setShowPermissions(false);
                    // The effect will re-run because permissionsState.mic changed
                    if (recognitionRef.current) {
                      try { recognitionRef.current.start(); } catch(e) {}
                    }
                  } catch (e: any) {
                    console.error("Mic permission failed", e);
                    if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
                      setPermissionStatus('not-found');
                    } else {
                      setPermissionStatus('denied');
                      setRecordingError("Permission denied. Enable in browser settings.");
                    }
                  }
                }}
                className="w-full py-5 bg-brand-violet text-white rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] shadow-2xl shadow-brand-violet/20 active:scale-95 transition-all"
              >
                Enable Neural Link
              </button>
            )}

            <button 
              onClick={() => setShowPermissions(false)}
              className="text-[10px] font-black uppercase text-white/30 tracking-widest hover:text-white/60 transition-all"
            >
              Skip Voice & Use Text
            </button>
          </div>
        </div>
      </motion.div>
    );
  };

  const HomeView = () => (
    <motion.div 
      key="home"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="space-y-4"
    >
      <GlassCard className="relative py-6 flex flex-col items-center justify-center border-white/5 bg-white/5 rounded-[32px]">
        <div className="flex items-baseline gap-2">
          <span className="text-5xl font-black tracking-tighter tabular-nums text-white">
            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
          </span>
          <span className="text-xs font-black text-brand-violet uppercase tracking-widest opacity-80">
            {currentTime.toLocaleTimeString([], { hour12: true }).split(' ')[1]}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1 opacity-20">
          <Clock size={8} />
          <span className="text-[8px] font-black uppercase tracking-[0.2em]">System Sync</span>
        </div>
      </GlassCard>

      <div className="text-center py-2">
        <h2 className="text-2xl font-black tracking-tighter">Hi, {profileData.name.split(' ')[0]}</h2>
        <p className="text-xs text-white/40 font-medium italic">"Hello Gemini" to speak</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="glass-panel bg-brand-violet/5 border-brand-violet/10 p-4 rounded-2xl flex items-center gap-3">
          <Zap size={16} className="text-brand-violet" />
          <div>
            <div className="text-[7px] font-black uppercase tracking-widest text-white/20">Focus</div>
            <div className="text-base font-black italic">98%</div>
          </div>
        </div>
        <div className="glass-panel bg-brand-green/5 border-brand-green/10 p-4 rounded-2xl flex items-center gap-3">
          <Clock size={16} className="text-brand-green" />
          <div>
            <div className="text-[7px] font-black uppercase tracking-widest text-white/20">Status</div>
            <div className="text-base font-black italic uppercase">Alpha</div>
          </div>
        </div>
      </div>

      <div className="pt-2">
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="text-[8px] font-black uppercase tracking-[0.3em] text-white/20">Next Push</h3>
          <button onClick={() => setActiveTab('alarms')} className="text-[8px] font-black uppercase tracking-widest text-brand-violet">View List</button>
        </div>
        {alarms.filter(a => a.isEnabled).length > 0 ? (
          <div className="space-y-2">
            {alarms.filter(a => a.isEnabled).slice(0, 1).map(alarm => (
              <GlassCard key={alarm.id} className="p-4 border-white/5 flex items-center justify-between group rounded-2xl">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-brand-violet/10 flex items-center justify-center text-brand-violet">
                    <Bell size={16} />
                  </div>
                  <div>
                    <div className="text-xl font-black italic tabular-nums leading-none">
                      {String(alarm.hour).padStart(2, '0')}:{String(alarm.minute).padStart(2, '0')}
                      <span className="text-[8px] uppercase font-black ml-1 opacity-40">{alarm.period}</span>
                    </div>
                    <div className="text-[8px] font-bold text-white/30 uppercase tracking-widest truncate max-w-[100px]">{alarm.label}</div>
                  </div>
                </div>
                <button onClick={() => toggleAlarm(alarm)} className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-white/40 hover:text-brand-violet transition-all">
                  <Pause size={14} />
                </button>
              </GlassCard>
            ))}
          </div>
        ) : (
          <div className="p-10 border border-dashed border-white/5 text-center rounded-2xl">
             <p className="text-[8px] font-black uppercase tracking-widest text-white/10">No sessions ready</p>
          </div>
        )}
      </div>
    </motion.div>
  );
  const AlarmsView = () => (
    <motion.div 
      key="alarms"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="space-y-4 pb-20"
    >
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className="text-2xl font-black italic tracking-tighter uppercase leading-none">Schedule</h2>
          <p className="text-[8px] font-black uppercase text-white/20 tracking-widest mt-1">Neural Pushes</p>
        </div>
        <div className="w-8 h-8 rounded-xl bg-brand-violet/10 border border-brand-violet/20 flex items-center justify-center text-brand-violet">
            <Clock size={16} />
        </div>
      </div>

      <div className="space-y-3">
        {alarms.length === 0 ? (
          <div className="py-12 text-center border-2 border-dashed border-white/5 rounded-[24px]">
            <p className="text-[8px] font-black uppercase tracking-widest text-white/20">Empty Drive</p>
            <button onClick={() => setShowCreateAlarm(true)} className="mt-2 text-brand-violet text-[8px] font-black uppercase tracking-widest">Bootstrap System</button>
          </div>
        ) : (
          alarms.map(alarm => (
            <GlassCard 
              key={alarm.id} 
              className={`border-white/5 p-4 transition-all duration-300 ${alarm.isEnabled ? 'ring-1 ring-brand-violet/10' : 'opacity-40 grayscale-[0.5]'}`}
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <div className="flex items-end gap-1">
                    <span className={`text-3xl font-black italic font-mono tracking-tighter leading-none transition-colors ${alarm.isEnabled ? 'text-white' : 'text-white/40'}`}>
                      {String(alarm.hour).padStart(2, '0')}:{String(alarm.minute).padStart(2, '0')}
                    </span>
                    <span className={`text-[7px] font-black uppercase tracking-widest mb-0.5 ${alarm.isEnabled ? 'text-brand-violet' : 'text-white/20'}`}>
                      {alarm.period}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                      <div className="text-[8px] font-black uppercase text-white/40 tracking-widest truncate max-w-[80px]">{alarm.label}</div>
                      <div className="w-0.5 h-0.5 rounded-full bg-white/10" />
                      <div className="text-[7px] font-bold text-white/20 uppercase truncate max-w-[60px]">{alarm.days.join(', ')}</div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-3">
                    <div 
                      onClick={() => toggleAlarm(alarm)}
                      className={`w-10 h-5 rounded-full relative transition-all duration-300 p-[2px] cursor-pointer ${alarm.isEnabled ? 'bg-brand-violet shadow-lg shadow-brand-violet/20' : 'bg-white/5 border border-white/5'}`}
                    >
                      <motion.div 
                        animate={{ x: alarm.isEnabled ? 20 : 0 }}
                        className="w-[16px] h-[16px] rounded-full bg-white shadow"
                      />
                    </div>
                    
                    <div className="flex items-center gap-1.5 mt-1">
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setDraftAlarm({
                            hour: alarm.hour,
                            minute: alarm.minute,
                            period: alarm.period,
                            label: alarm.label,
                            days: alarm.days,
                            noteType: alarm.noteType,
                            noteContent: alarm.noteContent,
                            audioUrl: alarm.audioUrl,
                            soundId: alarm.soundId,
                            date: alarm.date || new Date().toISOString().split('T')[0]
                          });
                          setEditingAlarmId(alarm.id);
                          setShowCreateAlarm(true);
                        }}
                        className="w-8 h-8 rounded-lg bg-white/5 text-white/40 flex items-center justify-center hover:bg-brand-violet/10 hover:text-brand-violet transition-all"
                      >
                        <Pencil size={12} />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setActiveAlarmId(alarm.id); }}
                        className="w-8 h-8 rounded-lg bg-brand-violet/10 text-brand-violet flex items-center justify-center hover:bg-brand-violet hover:text-white transition-all shadow shadow-brand-violet/10"
                      >
                        <Play size={12} fill="currentColor" />
                      </button>
                      <button 
                        onClick={(e) => deleteAlarm(alarm.id, e)}
                        className="w-8 h-8 rounded-lg bg-white/5 text-red-500/40 flex items-center justify-center hover:bg-red-500/10 hover:text-red-500 transition-all"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                </div>
              </div>
            </GlassCard>
          ))
        )}
      </div>
    </motion.div>
  );

  const AssistantView = () => (
    <motion.div 
      key="assistant"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="h-full flex flex-col justify-center items-center text-center p-8 space-y-8"
    >
      <div className="relative">
        <motion.div 
          animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.2, 0.1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute inset-x-[-40px] inset-y-[-40px] bg-brand-violet rounded-full blur-3xl opacity-10"
        />
        <div 
          onClick={handleCommandRecording}
          className="w-32 h-32 rounded-[40px] bg-brand-violet/10 border border-brand-violet/20 flex items-center justify-center text-brand-violet relative overflow-hidden group cursor-pointer"
        >
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            {showSuccessFeedback ? (
               <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="text-brand-green">
                 <Check size={64} />
               </motion.div>
            ) : isProcessing ? (
              <motion.div animate={{ rotate: 360, scale: [1, 1.1, 1] }} transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}>
                <Command size={48} />
              </motion.div>
            ) : (
              <Mic size={48} className={isCommandRecording ? 'animate-bounce' : ''} />
            )}
        </div>
      </div>
      <div className="space-y-3">
        <h2 className={`text-4xl font-black tracking-tighter italic transition-colors ${showSuccessFeedback ? 'text-brand-green' : ''}`}>
          {showSuccessFeedback ? 'Recognized!' : isProcessing ? 'Thinking...' : isCommandRecording ? 'Listening' : 'Assistant'}
        </h2>
        <p className="text-[10px] text-white/30 font-black uppercase tracking-[0.4em] max-w-[200px] leading-loose">
          {showSuccessFeedback ? 'Neural command executed' : isProcessing ? 'Processing neural link' : isCommandRecording ? 'Speak your command clearly' : 'Tap MIC for neural interact'}
        </p>
      </div>

      <div className="w-full max-w-xs relative group">
        <div className="absolute inset-0 bg-brand-violet/20 blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity" />
        <input 
          type="text"
          value={commandText}
          onChange={(e) => setCommandText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && commandText.trim()) {
              processTextCommand(commandText);
              setCommandText("");
            }
          }}
          placeholder="Type neural command..."
          className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-xs font-bold text-white placeholder-white/20 focus:outline-none focus:border-brand-violet focus:ring-1 focus:ring-brand-violet transition-all relative z-10"
        />
        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[8px] font-black uppercase tracking-widest text-white/20 pointer-events-none">
          ENTER
        </div>
      </div>

      <GlassCard className="w-full py-4 flex flex-col items-center justify-center gap-2 border-white/5 opacity-40">
          <div className="flex items-center gap-3">
            <div className={`w-1.5 h-1.5 rounded-full ${isProcessing || isCommandRecording ? 'bg-brand-green' : 'bg-brand-violet'}`} />
            <span className="text-[8px] font-black uppercase tracking-[0.3em]">Quantum Connection Secure</span>
          </div>
          {recordingError && (
            <p className="text-[8px] font-black uppercase tracking-[0.1em] text-red-500 animate-pulse">
              {recordingError}
            </p>
          )}
      </GlassCard>
    </motion.div>
  );

  const themeClass = currentTheme === 'Cyber Neon' ? 'theme-cyber' : (currentTheme === 'Royal Editorial' ? 'theme-editorial' : '');

  return (
    <div className={`h-[100dvh] max-h-[100dvh] bg-brand-space selection:bg-brand-violet/30 flex justify-center overflow-hidden font-theme ${themeClass}`}>
      <div className="w-full max-w-md bg-brand-space relative flex flex-col h-full overflow-hidden shadow-2xl">
        
        {/* Global Transitions for Views */}
        <AnimatePresence mode="wait" initial={false}>
          {activeAlarmId ? (
            <AlarmTriggerView key="trigger" />
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden relative">
              {/* Header (Image 16) */}
              <header className="px-6 py-4 flex justify-between items-center z-20 flex-shrink-0">
                <div 
                  onClick={() => setActiveTab('home')}
                  className="flex items-center gap-3 cursor-pointer"
                >
                  <div className="w-9 h-9 rounded-xl bg-brand-violet/10 border border-brand-violet/20 overflow-hidden flex items-center justify-center p-1.5 shadow-lg shadow-brand-violet/5">
                     <img src="/logo.png" alt="Logo" className="w-full h-full object-contain" onError={(e) => {
                       e.currentTarget.style.display = 'none';
                       if (e.currentTarget.parentElement) {
                         e.currentTarget.parentElement.innerHTML = '<div class="w-full h-full text-brand-violet flex items-center justify-center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg></div>';
                       }
                     }} />
                  </div>
                  <h1 className="text-lg font-black tracking-tighter uppercase italic">WakeNote<span className="text-brand-violet font-light">AI</span></h1>
                </div>
                
                <div className="flex gap-2.5">
                  <button 
                    onClick={handleCommandRecording}
                    className={`w-9 h-9 rounded-xl transition-all flex items-center justify-center ${showSuccessFeedback ? 'bg-brand-green text-white shadow-lg' : isCommandRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-white/5 text-white/30 hover:bg-white/10 border border-white/5'}`}
                  >
                    {showSuccessFeedback ? <Check size={16} /> : isCommandRecording ? <Command size={16} /> : <Mic size={16} />}
                  </button>
                  <button 
                    onClick={() => setActiveTab('settings')}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all bg-white/5 border border-white/5 ${activeTab === 'settings' ? 'text-brand-violet border-brand-violet/20' : 'text-white/30 hover:bg-white/10'}`}
                  >
                    <Settings size={16} />
                  </button>
                  <button 
                    onClick={() => setActiveTab('profile')}
                    className={`w-9 h-9 rounded-xl overflow-hidden border border-white/5 transition-all bg-white/5 ${activeTab === 'profile' ? 'border-brand-violet/50 scale-105 ring-2 ring-brand-violet/10' : 'hover:bg-white/10'}`}
                  >
                    <img 
                      src={profileData.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profileData.gender === 'female' ? 'female' : 'male'}`} 
                      className="w-full h-full object-cover" 
                      alt="Profile" 
                    />
                  </button>
                </div>
              </header>

              {/* Main Scrollable Area */}
              <main className="flex-1 overflow-y-auto px-6 pt-2 pb-32 hide-scrollbar relative">
                {/* Theme Effects Background */}
                <AnimatePresence>
                  {currentTheme === 'Cyber Neon' && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 pointer-events-none -z-10">
                      <div className="absolute top-20 left-10 w-40 h-40 bg-brand-violet/5 blur-[80px]" />
                      <div className="absolute bottom-40 right-10 w-40 h-40 bg-brand-green/5 blur-[80px]" />
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence mode="wait" initial={false}>
                  {activeTab === 'home' && HomeView()}
                  {activeTab === 'alarms' && AlarmsView()}
                  {activeTab === 'assistant' && AssistantView()}
                  {activeTab === 'profile' && ProfileView()}
                  {activeTab === 'settings' && SettingsView()}
                  {activeTab === 'themes' && ThemesView()}
                  {activeTab === 'voice-settings' && VoiceSettingsView()}
                  {activeTab === 'auth' && AuthView()}
                </AnimatePresence>
              </main>

              {showPermissions && PermissionsView()}

              {/* Redesigned Sticky Bottom Navigation (Image 7) */}
              {!activeAlarmId && (
                <nav className="absolute bottom-6 left-6 right-6 z-[60] flex-shrink-0">
                  <div className="glass-panel rounded-[32px] px-2 py-2 flex items-center justify-between border-white/10 bg-brand-space/40">
                    <NavButton active={activeTab === 'home'} icon={Home} label="Home" onClick={() => setActiveTab('home')} />
                    <NavButton active={activeTab === 'alarms'} icon={Clock} label="Alarms" onClick={() => setActiveTab('alarms')} />
                    
                    <motion.button 
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setShowCreateAlarm(true)}
                      className={`w-16 h-16 rounded-[24px] flex items-center justify-center transition-all bg-brand-violet text-white shadow-2xl shadow-brand-violet/30 -mt-2 group`}
                    >
                      <Plus size={28} className="transition-transform group-hover:rotate-90" />
                    </motion.button>

                    <NavButton active={activeTab === 'assistant'} icon={MessageSquare} label="AI" onClick={() => setActiveTab('assistant')} />
                    <NavButton active={activeTab === 'profile'} icon={UserIcon} label="Profile" onClick={() => setActiveTab('profile')} />
                  </div>
                </nav>
              )}
            </div>
          )}
        </AnimatePresence>

        {/* Create Alarm Modal Overlay */}
        <AnimatePresence>
          {showCreateAlarm && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-brand-space/90 backdrop-blur-md flex items-end"
            >
              <motion.div 
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                className="w-full h-[90vh] bg-brand-surface rounded-t-[48px] p-8 pb-12 border-t border-white/10 flex flex-col"
              >
                <div className="flex justify-between items-center mb-6 flex-shrink-0">
                  <div>
                    <h3 className="text-2xl font-black tracking-tighter">{editingAlarmId ? 'Edit Session' : 'New Alarm'}</h3>
                    <p className="text-[10px] font-black uppercase text-white/20 tracking-widest mt-1">{editingAlarmId ? 'Refine your push' : 'Configure your push'}</p>
                  </div>
                  <button onClick={() => { setShowCreateAlarm(false); setEditingAlarmId(null); }} className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/40 group hover:bg-white/10 transition-all">
                    <Plus size={20} className="rotate-45 group-hover:rotate-135 transition-transform" />
                  </button>
                </div>                <div className="flex-1 overflow-y-auto pr-1 space-y-5">
                  {/* Alarm Name Input (Top) */}
                  <div className="space-y-1">
                    <label className="text-[8px] font-black uppercase tracking-[0.2em] text-white/20 ml-1">Alarm Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Wake up!"
                      value={draftAlarm.label}
                      maxLength={30}
                      onChange={(e) => setDraftAlarm(p => ({ ...p, label: e.target.value }))}
                      className="w-full bg-white/5 border border-white/5 rounded-xl p-3 text-sm font-bold focus:outline-none focus:border-brand-violet/40 placeholder:text-white/10"
                    />
                  </div>

                  {/* Time Selection Card (Image 12) - More Compact */}
                  <div className="bg-white/5 rounded-[32px] border border-white/5 p-4 flex flex-col items-center">
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col items-center">
                        <button onClick={() => setDraftAlarm(p => ({ ...p, hour: p.hour === 12 ? 1 : p.hour + 1 }))} className="p-1 opacity-20 hover:opacity-100 transition-opacity">
                          <ChevronUp size={16} />
                        </button>
                        <span className="text-5xl font-black font-mono tracking-tighter tabular-nums leading-none">{String(draftAlarm.hour).padStart(2, '0')}</span>
                        <button onClick={() => setDraftAlarm(p => ({ ...p, hour: p.hour === 1 ? 12 : p.hour - 1 }))} className="p-1 opacity-20 hover:opacity-100 transition-opacity">
                          <ChevronDown size={16} />
                        </button>
                      </div>
                      <span className="text-3xl font-black font-mono text-brand-violet/40">:</span>
                      <div className="flex flex-col items-center">
                        <button onClick={() => setDraftAlarm(p => ({ ...p, minute: (p.minute + 1) % 60 }))} className="p-1 opacity-20 hover:opacity-100 transition-opacity">
                          <ChevronUp size={16} />
                        </button>
                        <span className="text-5xl font-black font-mono tracking-tighter tabular-nums leading-none">{String(draftAlarm.minute).padStart(2, '0')}</span>
                        <button onClick={() => setDraftAlarm(p => ({ ...p, minute: (p.minute - 1 + 60) % 60 }))} className="p-1 opacity-20 hover:opacity-100 transition-opacity">
                          <ChevronDown size={16} />
                        </button>
                      </div>
                      <div className="flex flex-col gap-1 ml-2">
                        {['AM', 'PM'].map(p => (
                          <button 
                            key={p}
                            onClick={() => setDraftAlarm(prev => ({ ...prev, period: p as any }))}
                            className={`px-3 py-1.5 rounded-lg text-[9px] font-black transition-all ${draftAlarm.period === p ? 'bg-brand-violet text-white shadow-lg' : 'bg-white/5 text-white/20'}`}
                          >{p}</button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-2">
                      <GlassCard 
                        onClick={() => setShowNoteView(true)}
                        className="p-4 border-brand-violet/10 bg-brand-violet/5 hover:bg-brand-violet/10 transition-all group rounded-2xl"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-brand-violet/20 flex items-center justify-center text-brand-violet">
                              <MessageSquare size={16} />
                            </div>
                            <div>
                               <div className="text-[8px] font-black uppercase tracking-widest text-white/60">Note & Voice</div>
                               <div className="text-[9px] font-bold text-white/40 truncate max-w-[150px]">
                                 {draftAlarm.noteContent || recordedAudio ? 'Configured' : 'Optional Push'}
                               </div>
                            </div>
                          </div>
                          <ChevronRight size={14} className="text-white/20" />
                        </div>
                      </GlassCard>

                      {/* Days Input - Compact */}
                      <GlassCard className="p-3 border-white/5 space-y-2 rounded-2xl">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Calendar size={14} className="text-brand-violet" />
                            <span className="text-[8px] font-black uppercase tracking-widest text-white/40">Repeat</span>
                          </div>
                          <div className="text-[8px] font-bold text-brand-violet uppercase">
                            {draftAlarm.days.length === 7 ? 'Daily' : draftAlarm.days.length === 0 ? 'Once' : `${draftAlarm.days.length} Days`}
                          </div>
                        </div>
                        <div className="flex justify-between gap-1">
                          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, idx) => {
                            const fullDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                            const isSelected = draftAlarm.days.includes(fullDays[idx]);
                            return (
                              <button 
                                key={idx}
                                onClick={() => toggleDay(fullDays[idx])}
                                className={`flex-1 aspect-square rounded-lg text-[8px] font-black transition-all flex items-center justify-center border ${isSelected ? 'bg-brand-violet border-brand-violet text-white' : 'bg-white/5 border-white/5 text-white/20'}`}
                              >
                                {day}
                              </button>
                            );
                          })}
                        </div>
                      </GlassCard>

                      <div className="grid grid-cols-1 gap-3">
                        {/* Improved Sound Selection Area */}
                        <div className="space-y-2">
                           <div className="flex items-center justify-between px-1">
                              <span className="text-[9px] font-black uppercase tracking-widest text-white/20">Sound Profile</span>
                              <button 
                                onClick={() => {
                                  setTempSoundId(draftAlarm.soundId);
                                  setIsSoundSelectorOpen(true);
                                }}
                                className="text-[10px] font-black uppercase tracking-widest text-brand-violet hover:text-brand-violet/60 transition-colors"
                              >
                                More Options
                              </button>
                           </div>
                           <GlassCard 
                             onClick={() => {
                               // Quick select default or currently playing toggled
                               if (draftAlarm.soundId !== 'chime') {
                                 setDraftAlarm(p => ({ ...p, soundId: 'chime' }));
                               }
                             }}
                             className={`flex items-center gap-4 p-4 border-white/5 transition-all ${draftAlarm.soundId === 'chime' ? 'bg-brand-violet/10 border-brand-violet/20' : ''}`}
                           >
                              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${draftAlarm.soundId === 'chime' ? 'bg-brand-violet text-white shadow-lg shadow-brand-violet/20' : 'bg-white/5 text-white/20'}`}>
                                <Volume2 size={20} />
                              </div>
                              <div className="flex-1">
                                <div className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-0.5">Recommended</div>
                                <div className="text-xs font-bold">Standard Chime (Default)</div>
                              </div>
                              {draftAlarm.soundId === 'chime' && (
                                <div className="w-5 h-5 rounded-full bg-brand-violet flex items-center justify-center">
                                  <Plus size={12} className="rotate-0 text-white" />
                                </div>
                              )}
                           </GlassCard>

                           {draftAlarm.soundId !== 'chime' && (
                             <GlassCard className="flex items-center gap-4 p-4 border-brand-violet/30 bg-brand-violet/5">
                                <div className="w-10 h-10 rounded-2xl bg-brand-violet text-white flex items-center justify-center">
                                  <Volume2 size={20} />
                                </div>
                                <div className="flex-1">
                                  <div className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-0.5">Selected Tone</div>
                                  <div className="text-xs font-bold">{SOUND_OPTIONS.find(s => s.id === draftAlarm.soundId)?.name || 'Custom'}</div>
                                </div>
                                <button 
                                  onClick={() => setIsSoundSelectorOpen(true)}
                                  className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center text-white/40 hover:bg-white/10"
                                >
                                  <Settings size={16} />
                                </button>
                             </GlassCard>
                           )}
                        </div>

                        {/* Repeat & Schedule */}
                        <div className="grid grid-cols-2 gap-3">
                           <GlassCard className="flex items-center gap-3 py-4 border-white/5">
                              <div className="w-8 h-8 rounded-xl bg-brand-violet/10 flex items-center justify-center text-brand-violet">
                                <Calendar size={16} />
                              </div>
                              <div>
                                <div className="text-[9px] font-black uppercase tracking-widest text-white/40 mb-0.5">Cycle</div>
                                <div className="text-[10px] font-bold uppercase">
                                  {draftAlarm.days.length === 7 ? 'Everyday' : draftAlarm.days.length === 0 ? 'Once' : `${draftAlarm.days.length} Days`}
                                </div>
                              </div>
                           </GlassCard>
                           <GlassCard className="flex items-center gap-3 py-4 border-white/5">
                              <div className="w-8 h-8 rounded-xl bg-brand-green/10 flex items-center justify-center text-brand-green">
                                <ShieldCheck size={16} />
                              </div>
                              <div>
                                <div className="text-[9px] font-black uppercase tracking-widest text-white/40 mb-0.5">Security</div>
                                <div className="text-[10px] font-bold uppercase italic">Active</div>
                              </div>
                           </GlassCard>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-6 flex-shrink-0">
                  <motion.button 
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setShowNoteView(true)}
                    className="w-full py-6 bg-brand-violet text-white rounded-[32px] font-black text-xs uppercase tracking-[0.3em] shadow-2xl shadow-brand-violet/30"
                  >
                    {editingAlarmId ? 'Update Session' : 'Save Alarm'}
                  </motion.button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Sound Selector Popup */}
        <AnimatePresence>
          {isSoundSelectorOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-brand-space/95 backdrop-blur-xl flex items-center justify-center p-6"
            >
              <GlassCard className="w-full max-w-sm p-8 space-y-6 flex flex-col h-[70vh]">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-2xl font-black tracking-tighter uppercase italic">Neural Tones</h3>
                    <p className="text-[10px] font-black uppercase text-white/20 tracking-widest mt-1">Select Alarm Sound</p>
                  </div>
                  <button 
                    onClick={() => {
                      setIsSoundSelectorOpen(false);
                      setTempSoundId(null);
                      if (soundPreviewAudioRef.current) soundPreviewAudioRef.current.pause();
                    }} 
                    className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/20 hover:bg-white/10"
                  >
                    <Plus size={20} className="rotate-45" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                  {SOUND_OPTIONS.map(sound => {
                    const isSelected = tempSoundId === sound.id || (draftAlarm.soundId === sound.id && !tempSoundId);
                    return (
                      <button 
                        key={sound.id}
                        onClick={() => {
                          setTempSoundId(sound.id);
                          if (soundPreviewAudioRef.current) {
                            soundPreviewAudioRef.current.src = sound.url;
                            soundPreviewAudioRef.current.play().catch(console.error);
                            setIsSoundPlaying(true);
                          }
                        }}
                        className={`w-full p-5 rounded-3xl border transition-all flex items-center justify-between group ${isSelected ? 'bg-brand-violet border-brand-violet shadow-xl shadow-brand-violet/20' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isSelected ? 'bg-white/20 text-white' : 'bg-brand-violet/10 text-brand-violet'}`}>
                            {isSelected && isSoundPlaying ? (
                              <div className="flex gap-1">
                                <div className="w-1 h-3 bg-white animate-pulse" />
                                <div className="w-1 h-3 bg-white animate-pulse" style={{ animationDelay: '0.2s' }} />
                                <div className="w-1 h-3 bg-white animate-pulse" style={{ animationDelay: '0.4s' }} />
                              </div>
                            ) : (
                              <Volume2 size={18} />
                            )}
                          </div>
                          <div className="text-left">
                            <div className={`text-xs font-black uppercase tracking-widest ${isSelected ? 'text-white' : 'text-white/60'}`}>{sound.name}</div>
                            <div className={`text-[8px] font-bold uppercase tracking-tighter ${isSelected ? 'text-white/60' : 'text-white/20'}`}>Neural Frequency Optimized</div>
                          </div>
                        </div>
                        {isSelected && (
                          <div 
                            onClick={(e) => {
                              e.stopPropagation();
                              setDraftAlarm(p => ({ ...p, soundId: sound.id }));
                              setIsSoundSelectorOpen(false);
                              setTempSoundId(null);
                              if (soundPreviewAudioRef.current) soundPreviewAudioRef.current.pause();
                            }}
                            className="px-4 py-2 bg-white text-brand-violet rounded-xl text-[8px] font-black uppercase tracking-widest shadow-lg hover:scale-110 active:scale-95 transition-all"
                          >
                            SET
                          </div>
                        )}
                      </button>
                    );
                  })}
                  <audio 
                    ref={soundPreviewAudioRef} 
                    className="hidden" 
                    onPlay={() => setIsSoundPlaying(true)}
                    onPause={() => setIsSoundPlaying(false)}
                    onEnded={() => setIsSoundPlaying(false)}
                  />
                </div>

                <button 
                  onClick={() => {
                    if (tempSoundId) setDraftAlarm(p => ({ ...p, soundId: tempSoundId }));
                    setIsSoundSelectorOpen(false);
                    setTempSoundId(null);
                    if (soundPreviewAudioRef.current) soundPreviewAudioRef.current.pause();
                  }}
                  className="w-full py-5 bg-brand-green text-brand-space rounded-[24px] font-black text-xs uppercase tracking-[0.4em] shadow-xl shadow-brand-green/20 active:scale-95 transition-all"
                >
                  SET SOUND
                </button>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Note Selection Popup */}
        <AnimatePresence>
          {showNoteView && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[120] bg-brand-space/98 backdrop-blur-2xl flex items-center justify-center p-6"
            >
              <GlassCard className="w-full max-w-sm p-8 space-y-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-40 h-40 bg-brand-violet/10 blur-3xl -mr-20 -mt-20" />
                
                <div className="text-center space-y-2">
                  <h3 className="text-3xl font-black tracking-tighter uppercase italic">{editingAlarmId ? 'Refine Session' : 'Neural Push'}</h3>
                  <p className="text-[10px] font-black uppercase text-white/20 tracking-[0.3em]">{editingAlarmId ? 'Update Motivation Layer' : 'Configure Motivation Layer'}</p>
                </div>

                <div className="space-y-4">
                  {/* Mode Toggles */}
                  <div className="flex bg-white/5 p-1 rounded-3xl border border-white/10">
                    <button 
                      onClick={() => setDraftAlarm(p => ({ ...p, noteType: 'text' }))}
                      className={`flex-1 py-4 rounded-2xl flex items-center justify-center gap-2 transition-all ${draftAlarm.noteType === 'text' ? 'bg-brand-violet text-white shadow-lg' : 'text-white/20'}`}
                    >
                      <MessageSquare size={16} />
                      <span className="text-[10px] font-black uppercase tracking-widest">Text Note</span>
                    </button>
                    <button 
                      onClick={() => setDraftAlarm(p => ({ ...p, noteType: 'voice' }))}
                      className={`flex-1 py-4 rounded-2xl flex items-center justify-center gap-2 transition-all ${draftAlarm.noteType === 'voice' ? 'bg-brand-violet text-white shadow-lg' : 'text-white/20'}`}
                    >
                      <Mic size={16} />
                      <span className="text-[10px] font-black uppercase tracking-widest">Voice Note</span>
                    </button>
                  </div>

                  <div className="min-h-[160px] flex flex-col">
                    {draftAlarm.noteType === 'voice' ? (
                      <div className="flex-1 bg-white/5 rounded-[40px] p-8 flex flex-col items-center justify-center gap-6 border border-white/5">
                        <motion.div 
                          animate={
                            showSuccessFeedback ? { scale: [1, 1.2, 1], rotate: [0, 10, -10, 0] } :
                            isRecording ? { scale: [1, 1.1, 1], boxShadow: ['0 0 0px 0px rgba(124,92,255,0)', '0 0 40px 10px rgba(124,92,255,0.2)', '0 0 0px 0px rgba(124,92,255,0)'] } : {}
                          }
                          transition={{ duration: showSuccessFeedback ? 0.5 : 1.5, repeat: showSuccessFeedback ? 0 : Infinity }}
                          className={`w-24 h-24 rounded-full flex items-center justify-center ${showSuccessFeedback ? 'bg-brand-green' : isRecording ? 'bg-red-500' : 'bg-brand-violet/20'} text-white shadow-2xl transition-colors`}
                        >
                          {showSuccessFeedback ? <Check size={40} /> : <Mic size={40} className={isRecording ? 'animate-pulse' : ''} />}
                        </motion.div>
                        
                        <div className="text-center">
                          <p className={`text-[10px] font-black uppercase tracking-[0.2em] mb-4 transition-colors ${recordingError ? 'text-red-500' : showSuccessFeedback ? 'text-brand-green' : 'text-white/40'}`}>
                            {recordingError ? recordingError : showSuccessFeedback ? 'Command Recognized' : isRecording ? 'Recording Audio...' : isProcessing ? 'Neural Transcribing...' : recordedAudio ? 'Audio Captured' : 'Ready to Record'}
                          </p>
                          <div className="flex flex-col gap-4 items-center">
                            <button 
                              onClick={isRecording ? stopRecording : startRecording}
                              disabled={isProcessing}
                              className={`px-8 py-4 rounded-3xl font-black text-[10px] uppercase tracking-widest transition-all ${isRecording ? 'bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)]' : 'bg-brand-violet text-white'} ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                              {isRecording ? 'Stop Now' : recordedAudio ? 'Re-record' : 'Start Neural capture'}
                            </button>
                            
                            {recordedAudio && !isRecording && !isProcessing && (
                              <button 
                                onClick={() => {
                                  if (audioPreviewRef.current) {
                                    audioPreviewRef.current.src = recordedAudio;
                                    audioPreviewRef.current.play().catch(console.error);
                                  }
                                }}
                                className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-brand-green hover:text-brand-green/70 transition-colors"
                              >
                                <Play size={12} fill="currentColor" />
                                Test Playback
                              </button>
                            )}
                          </div>
                        </div>
                        <audio ref={audioPreviewRef} className="hidden" />
                      </div>
                    ) : (
                      <div className="flex-1 space-y-4">
                        <div className="relative">
                          <textarea 
                            placeholder="Write your motivational note here..."
                            value={draftAlarm.noteContent}
                            onChange={(e) => setDraftAlarm(p => ({ ...p, noteContent: e.target.value }))}
                            className="w-full h-40 bg-white/5 border border-white/10 rounded-[40px] p-6 text-sm font-medium focus:outline-none focus:border-brand-violet/30 placeholder:text-white/10 resize-none"
                          />
                          <button 
                            onClick={handleAIGenerateNote}
                            className="absolute bottom-5 right-5 w-12 h-12 bg-white text-brand-space rounded-2xl shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all group"
                          >
                            <Zap size={20} className="group-hover:text-brand-violet transition-colors" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3 pt-4">
                  <button 
                    onClick={() => {
                      handleSaveAlarm(true);
                    }}
                    className="w-full py-6 bg-brand-violet text-white rounded-[32px] font-black text-xs uppercase tracking-[0.4em] shadow-2xl shadow-brand-violet/30 active:scale-[0.98] transition-all"
                  >
                    {editingAlarmId ? 'Confirm Changes' : 'Confirm Note'}
                  </button>
                  <button 
                    onClick={() => {
                      setDraftAlarm(p => ({ ...p, noteType: 'none', noteContent: '' }));
                      setRecordedAudio(null);
                      handleSaveAlarm(true);
                    }}
                    className="w-full py-4 text-white/20 font-black text-[10px] uppercase tracking-[0.4em] hover:text-white/40 transition-colors"
                  >
                    Skip Motivation
                  </button>
                </div>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Email Signup Modal */}
        <AnimatePresence>
          {showEmailModal && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-brand-space/95 backdrop-blur-xl flex items-center justify-center p-6"
            >
              <GlassCard className="w-full max-w-sm p-8 space-y-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-brand-violet/10 blur-3xl -mr-16 -mt-16" />
                
                <div className="flex justify-between items-center">
                  <h3 className="text-2xl font-black tracking-tighter">{authMode === 'login' ? 'Welcome Back' : 'Join WakeNoteAI'}</h3>
                  <button onClick={() => setShowEmailModal(false)} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/20 hover:bg-white/10 transition-colors">
                    <Plus size={16} className="rotate-45" />
                  </button>
                </div>

                <div className="space-y-4">
                  {authMode === 'signup' && (
                    <div className="space-y-1">
                      <label className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30 ml-1">Full Name</label>
                      <input 
                        type="text" 
                        placeholder="John Doe"
                        value={emailForm.name}
                        onChange={(e) => setEmailForm(p => ({ ...p, name: e.target.value }))}
                        className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-brand-violet/40"
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30 ml-1">Email Address</label>
                    <input 
                      type="email" 
                      placeholder="hello@example.com"
                      value={emailForm.email}
                      onChange={(e) => setEmailForm(p => ({ ...p, email: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-brand-violet/40"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30 ml-1">Password</label>
                    <input 
                      type="password" 
                      placeholder="••••••••"
                      value={emailForm.password}
                      onChange={(e) => setEmailForm(p => ({ ...p, password: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm font-bold focus:outline-none focus:border-brand-violet/40"
                    />
                  </div>
                </div>

                <button 
                  onClick={handleEmailAuth}
                  className="w-full py-5 bg-brand-violet text-white rounded-[24px] font-black text-xs uppercase tracking-[0.3em] shadow-xl shadow-brand-violet/30 active:scale-[0.98] transition-all"
                >
                  {authMode === 'login' ? 'Login' : 'Create Account'}
                </button>
                
                <p className="text-[8px] text-white/10 text-center uppercase tracking-widest uppercase">By continuing you agree to our Terms of Service</p>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Verification Modal */}
        <AnimatePresence>
          {showVerificationModal && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[110] bg-brand-space/98 backdrop-blur-2xl flex items-center justify-center p-6"
            >
              <GlassCard className="w-full max-w-xs p-8 text-center space-y-8">
                <div className="w-20 h-20 rounded-[32px] bg-brand-violet/10 flex items-center justify-center text-brand-violet mx-auto">
                  <ShieldCheck size={40} />
                </div>
                
                <div>
                  <h3 className="text-xl font-black tracking-tight mb-2">Verify Your Email</h3>
                  <p className="text-xs text-white/40 leading-relaxed">We've sent a 6-digit code to <span className="text-white">{emailForm.email}</span>. Please enter it below.</p>
                </div>

                <div className="space-y-6">
                  <input 
                    type="text" 
                    placeholder="0 0 0 0 0 0"
                    maxLength={6}
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full bg-white/5 border-b-2 border-brand-violet/20 rounded-none p-4 text-3xl font-black tracking-[0.5em] text-center focus:outline-none focus:border-brand-violet"
                  />
                  
                  <button 
                    onClick={() => {
                      setShowVerificationModal(false);
                      // In a real app, this would verify the code and sign in
                      setActiveTab('home');
                    }}
                    className="w-full py-5 bg-brand-violet text-white rounded-[24px] font-black text-xs uppercase tracking-[0.3em] shadow-xl shadow-brand-violet/30 active:scale-[0.98] transition-all"
                  >
                    Verify
                  </button>
                  
                  <button className="text-[10px] font-black text-white/20 uppercase tracking-widest hover:text-white/40 transition-colors">Resend Code</button>
                </div>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Warning Modal */}
        <AnimatePresence>
          {showNoteWarning && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[70] bg-brand-space/95 flex items-center justify-center p-8 backdrop-blur-md"
            >
              <GlassCard className="max-w-xs w-full text-center space-y-6 py-8">
                <div className="w-16 h-16 rounded-full bg-brand-warning/10 text-brand-warning flex items-center justify-center mx-auto">
                  <AlertCircle size={32} />
                </div>
                <div>
                  <h3 className="text-xl font-black tracking-tight mb-2">No Note Added</h3>
                  <p className="text-sm text-white/40 font-medium">Without a note, WakeNoteAI will only play a standard tone. Adding a "Why" helps you wake up better.</p>
                </div>
                <div className="space-y-3 pt-2">
                  <button 
                    onClick={() => setShowNoteWarning(false)}
                    className="w-full py-4 bg-brand-violet text-white rounded-2xl font-black tracking-widest text-xs"
                  >
                    ADD NOTE
                  </button>
                  <button 
                    onClick={() => handleSaveAlarm(true)}
                    className="w-full py-3 text-white/20 hover:text-white/40 font-black tracking-widest text-[10px] uppercase"
                  >
                    SKIP
                  </button>
                </div>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}

