# Project Blueprint: Cloud of Thoughts (ענן המחשבות)

This document provides a comprehensive technical specification for rebuilding the application. It is structured as a system architecture prompt.

## 1. System Overview
**Name**: Cloud of Thoughts (ענן המחשבות)
**Goal**: A premium AI-powered personal diary and coaching assistant that uses voice/text input to track emotional momentum, detect contradictions, and provide Socratic insights.
**Core Features**:
- Voice & Text recording with AI processing.
- 3D interactive background (Constellation).
- Real-time Multimodal Voice Chat (Gemini Live).
- Automated personal analysis (Emotional momentum, Recurring themes, Growth milestones).
- Google Drive synchronization for cross-device state persistence.

## 2. Technical Stack
- **Framework**: React 19 + Vite 7 + TypeScript 5
- **Styling**: Tailwind CSS 4 (Vanilla CSS aesthetics)
- **3D Engine**: Three.js + @react-three/fiber + @react-three/drei
- **AI Core**: Google Gemini API (@google/generative-ai)
- **Real-time AI**: Gemini Multimodal Live API (WebSocket PCM stream)
- **State Management**: Zustand + Persist Middleware
- **Auth & Storage**: Google Identity Services (GIS) + Google Drive API v3

## 3. Core Directory Structure
```text
/
├── src/
│   ├── components/
│   │   ├── Constellation.tsx   # 3D Galaxy/Background logic (R3F)
│   │   └── VoicePulse.tsx      # SVG Animation logic for audio input
│   ├── services/
│   │   ├── ai.ts               # Gemini API wrappers: Session processing, persona building
│   │   ├── drive.ts            # GDrive API: Login (GIS), State Sync (Download/Upload)
│   │   └── live-ai.ts          # Real-time WebSocket logic: 16kHz PCM upload, 24kHz PCM play
│   ├── store.ts                # Zustand state: Entries, Persona, Weekly Insights, Tasks
│   ├── App.tsx                 # Main layout, Navigation, Tab management
│   ├── App.css                 # Custom premium UI styling
│   └── main.tsx                # Entry point
├── public/                     # Icons, Manifest, Assets
├── index.html                  # GAPI/GIS script imports
├── package.json                # Dependencies: three, framer-motion, lucide-react, etc.
└── firebase.json               # Hosting config & SPAs rewrites
```

## 4. Key Logic & Services

### A. Intelligence Engine (ai.ts)
- **Session Processing**: Converts audio/text into a session object containing: `summary`, `tasks`, `insights`, `emotionalTone`.
- **User Persona**: A background process that aggregates history to track:
    - **Emotional Momentum**: Improving/Declining/Stable.
    - **Recurring Themes**: Topics like "Career", "Health" with intensity/trend.
    - **Contradictions**: Identifying where the user's current statements conflict with historical ones.
- **Weekly Insights**: Generates a high-level briefing once a week based on entries.

### B. Real-time Interaction (live-ai.ts)
- **Protocol**: WebSocket (WSS) connecting to `BiDiGenerateContent`.
- **Audio Spec**:
    - Input: 16000Hz PCM 16-bit (Base64 string chunks).
    - Output: 24000Hz PCM 16-bit.
- **System Instruction**: Socratic coach persona, empathetic, Hebrew-speaking.

### C. Persistence & Sync (drive.ts)
- **Method**: Single JSON file `diary_state.json` stored in a hidden `AI_Diary_Backups` folder on user's GDrive.
- **Flow**:
    1. Auth via GIS `google.accounts.oauth2.initTokenClient`.
    2. On load: Check GDrive, download state if exists, merge with local Zustand.
    3. On change: Debounced upload to GDrive.

## 5. UI/UX Specifications
- **Theme**: Premium Dark/Blue Gradient (`bg-gradient-to-b from-[#5FA5CF] via-[#85BBD8] to-[#0A3B66]`).
- **Layout**: Mobile-first, centered card layout (max-width 448px/md).
- **Navigation**: Bottom nav bar with Backdrop-blur (Glassmorphism).
- **Interactive Elements**:
    - Central Recording Button: Glows and pulses during activity.
    - Constellation: Particles moving in a galaxy pattern that reacts to app state.

## 6. Dependencies (package.json)
- `@google/generative-ai`
- `three`, `@react-three/fiber`, `@react-three/drei`
- `framer-motion` (UI animations)
- `zustand` (State)
- `lucide-react` (Icons)
- `clsx`, `tailwind-merge` (Styling utilities)
