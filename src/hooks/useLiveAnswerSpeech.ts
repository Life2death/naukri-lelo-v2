import { useCallback, useEffect, useRef, useState } from "react";
import { STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib/storage";

export const LIVE_ANSWER_SPEECH_EVENT = "live-answer-speech-state";
// Fired by the global speak-answer hotkey to toggle reading the current answer.
export const SPEAK_ANSWER_HOTKEY_EVENT = "speak-answer-hotkey";
// Fired by the global hold-to-read-answer hotkey on physical key down/up.
export const READ_ANSWER_HOLD_DOWN_EVENT = "read-answer-hold-down";
export const READ_ANSWER_HOLD_UP_EVENT = "read-answer-hold-up";

type SpeechSettings = {
  enabled: boolean;
  rate: number;
};

const DEFAULT_SETTINGS: SpeechSettings = {
  enabled: false,
  rate: 1,
};

export const SPEECH_RATE_MIN = 0.7;
export const SPEECH_RATE_MAX = 4;

const clampRate = (rate: number) =>
  Math.min(Math.max(rate, SPEECH_RATE_MIN), SPEECH_RATE_MAX);

const readSettings = (): SpeechSettings => {
  try {
    const stored = safeLocalStorage.getItem(STORAGE_KEYS.LIVE_ANSWER_SPEECH);
    if (!stored) return DEFAULT_SETTINGS;

    const parsed = JSON.parse(stored) as Partial<SpeechSettings>;
    return {
      enabled: Boolean(parsed.enabled),
      rate: clampRate(Number(parsed.rate) || 1),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

const cleanForSpeech = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, " Code example omitted. ")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[>#*_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const useLiveAnswerSpeech = (
  answer: string,
  isGenerating: boolean
) => {
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const [settings, setSettings] = useState<SpeechSettings>(readSettings);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const requestIdRef = useRef(0);
  const lastAutoSpokenRef = useRef("");
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which answer text the current hold-to-read utterance belongs to. A fresh
  // answer (this ref stale) means the next key-down must start from the
  // beginning rather than resume — a paused utterance is never resumed
  // across two different answers.
  const heldAnswerRef = useRef("");

  const announceSpeechState = useCallback((speaking: boolean) => {
    window.dispatchEvent(
      new CustomEvent(LIVE_ANSWER_SPEECH_EVENT, { detail: { speaking } })
    );
  }, []);

  const clearWatchdog = () => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  // Only announce "stopped" if we were actually speaking — otherwise every
  // no-op stop() (e.g. one fired per streamed answer chunk) would re-arm the
  // TTS-echo mute window in useSystemAudio even though nothing was playing.
  const stop = useCallback(() => {
    if (!supported) return;

    clearWatchdog();
    requestIdRef.current += 1;
    const wasSpeaking = window.speechSynthesis.speaking;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    if (wasSpeaking) announceSpeechState(false);
  }, [announceSpeechState, supported]);

  const speak = useCallback(
    (text = answer) => {
      if (!supported) return;

      const spokenText = cleanForSpeech(text);
      if (!spokenText) return;

      stop();
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.rate = settings.rate;
      utterance.onstart = () => {
        if (requestId !== requestIdRef.current) return;
        setIsSpeaking(true);
        setIsPaused(false);
        announceSpeechState(true);
      };
      utterance.onend = () => {
        if (requestId !== requestIdRef.current) return;
        clearWatchdog();
        setIsSpeaking(false);
        setIsPaused(false);
        announceSpeechState(false);
      };
      utterance.onerror = () => {
        if (requestId !== requestIdRef.current) return;
        clearWatchdog();
        setIsSpeaking(false);
        setIsPaused(false);
        announceSpeechState(false);
      };

      window.speechSynthesis.speak(utterance);

      // Some browsers silently fail to fire onend/onerror (e.g. a backgrounded
      // tab suspending speechSynthesis) which would otherwise leave audio
      // capture muted forever. Bound how long a single utterance can hold the
      // mute by force-stopping after a generous ceiling.
      const estimatedSpeechMs = (spokenText.length / 15 / settings.rate) * 1000;
      const watchdogMs = Math.min(Math.max(estimatedSpeechMs * 3, 15000), 120000);
      watchdogRef.current = setTimeout(() => {
        if (requestId === requestIdRef.current) stop();
      }, watchdogMs);
    },
    [announceSpeechState, answer, settings.rate, stop, supported]
  );

  const togglePause = useCallback(() => {
    if (!supported || !isSpeaking) return;

    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    } else {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }, [isSpeaking, supported]);

  // Key-down for the hold-to-read hotkey: start fresh on a new answer,
  // resume in place on the same answer, or no-op if OS key-repeat re-fires
  // while already playing.
  const playHeld = useCallback(() => {
    if (!supported || isGenerating || !answer.trim()) return;

    const synth = window.speechSynthesis;
    const sameAnswer = heldAnswerRef.current === answer;

    if (sameAnswer && synth.speaking && !synth.paused) return;

    if (sameAnswer && synth.speaking && synth.paused) {
      clearWatchdog();
      synth.resume();
      setIsPaused(false);
      // Re-arm the TTS-echo mute: pauseHeld announced "not speaking" on
      // release so capture could un-mute, so resuming has to announce
      // "speaking" again or the resumed audio gets captured and re-transcribed.
      announceSpeechState(true);
      const spokenText = cleanForSpeech(answer);
      const estimatedSpeechMs = (spokenText.length / 15 / settings.rate) * 1000;
      const watchdogMs = Math.min(Math.max(estimatedSpeechMs * 3, 15000), 120000);
      const requestId = requestIdRef.current;
      watchdogRef.current = setTimeout(() => {
        if (requestId === requestIdRef.current) stop();
      }, watchdogMs);
      return;
    }

    heldAnswerRef.current = answer;
    speak(answer);
  }, [answer, isGenerating, settings.rate, speak, stop, supported]);

  // Key-up for the hold-to-read hotkey: pause in place (never cancel) so the
  // next key-down can resume from this exact position.
  const pauseHeld = useCallback(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    if (synth.speaking && !synth.paused) {
      clearWatchdog();
      synth.pause();
      setIsPaused(true);
      // Critical: announce "not speaking" so useSystemAudio un-mutes capture.
      // Without this the mute set on key-down is never lifted — and because a
      // muted pipeline delivers no audio, no new answer is ever generated, so
      // nothing else would ever call stop() to lift it either. The app goes
      // permanently deaf until capture is manually restarted.
      announceSpeechState(false);
    }
  }, [announceSpeechState, supported]);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      const next = { ...settings, enabled };
      setSettings(next);
      safeLocalStorage.setItem(
        STORAGE_KEYS.LIVE_ANSWER_SPEECH,
        JSON.stringify(next)
      );
      if (!enabled) stop();
    },
    [settings, stop]
  );

  const setRate = useCallback(
    (rate: number) => {
      const next = { ...settings, rate: clampRate(rate) };
      setSettings(next);
      safeLocalStorage.setItem(
        STORAGE_KEYS.LIVE_ANSWER_SPEECH,
        JSON.stringify(next)
      );
    },
    [settings]
  );

  // Stop any in-progress playback the moment a new generation starts. Keyed
  // only on isGenerating (not `answer`, which changes on every streamed
  // chunk) so this doesn't re-fire — and re-arm the TTS-echo mute window in
  // useSystemAudio — on every chunk of a single response.
  useEffect(() => {
    if (isGenerating) {
      lastAutoSpokenRef.current = "";
      heldAnswerRef.current = "";
      stop();
    }
  }, [isGenerating, stop]);

  useEffect(() => {
    if (isGenerating) return;

    if (
      settings.enabled &&
      answer.trim() &&
      answer !== lastAutoSpokenRef.current
    ) {
      lastAutoSpokenRef.current = answer;
      speak(answer);
    }
  }, [answer, isGenerating, settings.enabled, speak]);

  // Global speak-answer hotkey: toggle reading the current answer aloud.
  useEffect(() => {
    const handleHotkey = () => {
      if (!supported) return;
      if (window.speechSynthesis.speaking) {
        stop();
      } else if (!isGenerating) {
        speak(answer);
      }
    };
    window.addEventListener(SPEAK_ANSWER_HOTKEY_EVENT, handleHotkey);
    return () =>
      window.removeEventListener(SPEAK_ANSWER_HOTKEY_EVENT, handleHotkey);
  }, [supported, isGenerating, answer, speak, stop]);

  // Global hold-to-read-answer hotkey: press-and-hold to play, release to
  // pause in place. A new answer always restarts from the beginning (see the
  // heldAnswerRef reset above) rather than resuming the previous one.
  useEffect(() => {
    window.addEventListener(READ_ANSWER_HOLD_DOWN_EVENT, playHeld);
    window.addEventListener(READ_ANSWER_HOLD_UP_EVENT, pauseHeld);
    return () => {
      window.removeEventListener(READ_ANSWER_HOLD_DOWN_EVENT, playHeld);
      window.removeEventListener(READ_ANSWER_HOLD_UP_EVENT, pauseHeld);
    };
  }, [playHeld, pauseHeld]);

  useEffect(() => stop, [stop]);

  return {
    enabled: settings.enabled,
    rate: settings.rate,
    isSpeaking,
    isPaused,
    supported,
    setEnabled,
    setRate,
    speak,
    stop,
    togglePause,
  };
};
