import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';

export function useDictation(
  language: string,
  append: (text: string) => void,
  error: (text: string) => void,
) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const active = useRef(true);
  const starting = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      clearTimeout(timer.current);
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state !== 'inactive') recorder.current.stop();
      }
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  async function toggle() {
    if (recorder.current?.state === 'recording') {
      recorder.current.stop();
      return;
    }
    if (transcribing || starting.current) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      error('Microphone recording needs a supported browser on localhost or HTTPS.');
      return;
    }
    starting.current = true;
    error('');
    try {
      const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active.current) {
        audio.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = audio;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const current = new MediaRecorder(
        audio,
        mimeType ? { mimeType, audioBitsPerSecond: 64000 } : undefined,
      );
      recorder.current = current;
      const chunks: BlobPart[] = [];
      current.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      current.onerror = () => {
        error('Microphone recording failed. Please try again.');
        audio.getTracks().forEach((track) => track.stop());
        setRecording(false);
      };
      current.onstop = async () => {
        clearTimeout(timer.current);
        audio.getTracks().forEach((track) => track.stop());
        if (!active.current) return;
        setRecording(false);
        setTranscribing(true);
        try {
          const blob = new Blob(chunks, { type: current.mimeType });
          if (blob.size < 100)
            throw new Error('No audio recorded. Tap Dictate and speak before stopping.');
          if (blob.size > 2800000)
            throw new Error('Recording is too large. Please dictate a shorter message.');
          const audioData = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(new Error('Could not read the recording.'));
            reader.readAsDataURL(blob);
          });
          const result = await api<{ text: string }>('/copilot/transcribe', 'POST', {
            audio: audioData,
            mimeType: blob.type.split(';')[0],
            language,
          });
          if (active.current) append(result.text);
        } catch (e) {
          if (active.current) error((e as Error).message);
        } finally {
          if (active.current) setTranscribing(false);
        }
      };
      current.start();
      setRecording(true);
      timer.current = setTimeout(() => {
        if (current.state === 'recording') current.stop();
      }, 60000);
    } catch (e) {
      stream.current?.getTracks().forEach((track) => track.stop());
      error(
        (e as Error).name === 'NotAllowedError'
          ? 'Allow microphone access in your browser to dictate.'
          : 'Could not start the microphone. Check that another app is not using it.',
      );
    } finally {
      starting.current = false;
    }
  }
  return { recording, transcribing, toggle };
}
